import { describe, expect, it } from "vitest";
import { cancelRefundShare } from "./cancel-refund-share.js";

describe("cancelRefundShare", () => {
  it.each([
    [{ quantity: "3", gross: "10.00" }, "0", "1", "3.33"],
    [{ quantity: "3", gross: "10.00" }, "1", "1", "3.34"],
    [{ quantity: "3", gross: "10.00" }, "0", "2", "6.67"],
    [{ quantity: "6", gross: "10.00" }, "0", "1", "1.67"],
    [{ quantity: "6", gross: "10.00" }, "1", "1", "1.66"],
    [{ quantity: "3.000", gross: "10.00" }, "2.000", "1", "3.33"],
  ])("shares %j after %s cancelled, for %s more, as %s", (value, before, quantity, expected) => {
    expect(cancelRefundShare(value, before, quantity)).toBe(expected);
  });
});
