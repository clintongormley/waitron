import { describe, expect, it } from "vitest";
import { CarriedApproval } from "./carried-approval.js";

const marta = { personId: "m-1", pin: "7777" };

describe("a carried approval", () => {
  it("gives the approver once for each sale it was given for", () => {
    const carried = new CarriedApproval(marta, ["sale-1", "sale-2"]);
    expect(carried.take("sale-1")).toEqual(marta);
    expect(carried.take("sale-1")).toBeUndefined();
    expect(carried.take("sale-2")).toEqual(marta);
    expect(carried.take("sale-2")).toBeUndefined();
  });

  it("gives nothing for a sale it was not given for, and keeps it for the others", () => {
    const carried = new CarriedApproval(marta, ["sale-1"]);
    expect(carried.take("sale-9")).toBeUndefined();
    expect(carried.take("sale-1")).toEqual(marta);
  });

  it("counts a sale whose refund was sent without it, and drops the PIN after the last sale", () => {
    const carried = new CarriedApproval(marta, ["sale-1", "sale-2"]);
    carried.markSent("sale-1");
    expect(carried.take("sale-1")).toBeUndefined();
    expect(carried.take("sale-2")).toEqual(marta);
    const other = new CarriedApproval(marta, ["sale-1", "sale-2"]);
    expect(other.take("sale-1")).toEqual(marta);
    other.markSent("sale-2");
    expect(other.take("sale-2")).toBeUndefined();
    expect(other.held).toBe(false);
  });

  it("gives nothing once cleared", () => {
    const carried = new CarriedApproval(marta, ["sale-1", "sale-2"]);
    carried.clear();
    expect(carried.take("sale-1")).toBeUndefined();
    expect(carried.take("sale-2")).toBeUndefined();
  });

  it("hands out a copy, so changing it changes nothing kept", () => {
    const carried = new CarriedApproval({ ...marta }, ["sale-1", "sale-2"]);
    carried.take("sale-1")!.pin = "0000";
    expect(carried.take("sale-2")).toEqual(marta);
  });
});
