import { describe, expect, it } from "vitest";
import { defaultGuestCount, isValidGuestCount, MAX_GUEST_COUNT } from "./guest-count.js";

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

describe("defaultGuestCount", () => {
  it("is the party's count when the party has exactly one bill", () => {
    expect(defaultGuestCount({ guestCount: 4, billCount: 1 })).toBe(4);
    expect(defaultGuestCount({ guestCount: MAX_GUEST_COUNT, billCount: 1 })).toBe(MAX_GUEST_COUNT);
  });

  it("is null when the party has no bill or more than one", () => {
    expect(defaultGuestCount({ guestCount: 4, billCount: 0 })).toBeNull();
    expect(defaultGuestCount({ guestCount: 4, billCount: 2 })).toBeNull();
  });

  it("is null when the party has no count", () => {
    expect(defaultGuestCount({ guestCount: null, billCount: 1 })).toBeNull();
  });

  it("is null when the count is not a valid guest count", () => {
    expect(defaultGuestCount({ guestCount: MAX_GUEST_COUNT + 1, billCount: 1 })).toBeNull();
    expect(defaultGuestCount({ guestCount: 2.5, billCount: 1 })).toBeNull();
    expect(defaultGuestCount({ guestCount: 0, billCount: 1 })).toBeNull();
  });
});
