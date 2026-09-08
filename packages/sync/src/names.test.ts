import { describe, expect, it } from "vitest";
import { lsnGte, subscriptionName } from "./names.js";

describe("subscriptionName", () => {
  it("names the subscription after the SUBSCRIBER's node id (C1), dashes stripped to 32 hex", () => {
    expect(subscriptionName("production", "00000000-0000-4000-8000-000000000001")).toBe(
      "waitron_production_sub_00000000000040008000000000000001",
    );
  });

  it("stays within the 58-char bound even for the longer environment", () => {
    // `preproduction` is the longer of the two, and the slot on the publisher carries the SAME name,
    // so both sides must fit. This is the tightest case: exactly 58 chars, ≤ 58.
    const name = subscriptionName("preproduction", "ffffffff-ffff-4fff-bfff-ffffffffffff");
    expect(name).toBe("waitron_preproduction_sub_ffffffffffff4fffbfffffffffffffff");
    expect(name.length).toBeLessThanOrEqual(58);
    expect(name.length).toBe(58);
  });

  it("throws on a value that is not a UUID (a wiring bug, refused loudly)", () => {
    expect(() => subscriptionName("production", "not-a-uuid")).toThrow();
    expect(() => subscriptionName("production", "")).toThrow();
  });
});

describe("lsnGte", () => {
  it("compares two pg_lsn values, low segment and across the high segment", () => {
    expect(lsnGte("0/10", "0/10")).toBe(true);
    expect(lsnGte("0/8", "0/10")).toBe(false); // 0x8 < 0x10
    expect(lsnGte("1/0", "0/FFFFFFFF")).toBe(true); // a higher high segment wins
  });

  it("refuses a value that is not an LSN", () => {
    expect(() => lsnGte("not-an-lsn", "0/10")).toThrow();
  });
});
