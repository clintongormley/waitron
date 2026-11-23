import { describe, expect, it } from "vitest";
import { cancelRefundShare, rowCancelRefund } from "./cancel-refund-share.js";

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

describe("rowCancelRefund", () => {
  it.each([
    [["9.37", "9.38", "9.38"], "1", "9.37"],
    [["9.37", "9.38", "9.38"], "2", "18.75"],
    [["9.37", "9.38", "9.38"], "3.000", "28.13"],
  ])("refunds the first portions of %j for %s as %s", (refunds, quantity, expected) => {
    expect(rowCancelRefund(refunds, quantity)).toBe(expected);
  });

  it.each(["0", "4", "1.5", "-1", ""])("refunds nothing for %j portions of three", (quantity) => {
    expect(rowCancelRefund(["9.37", "9.38", "9.38"], quantity)).toBeUndefined();
  });
});
