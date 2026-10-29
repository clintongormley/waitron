import { describe, expect, it } from "vitest";
import { heldRow } from "./held-row.js";

const sent = (memberIds: string[], quantity: string) =>
  heldRow(memberIds, quantity, { menuItemId: "m" }).map(
    (line) => `${line.workingOrderLineId}:${line.quantity}`,
  );

describe("heldRow", () => {
  it("sends a row stored as one line at the count", () => {
    expect(sent(["a"], "3")).toEqual(["a:3"]);
    expect(sent(["a"], "0.250")).toEqual(["a:0.250"]);
  });

  it("sends a row of portions one member per dish, leaving out the members past the count", () => {
    expect(sent(["a", "b", "c"], "3")).toEqual(["a:1", "b:1", "c:1"]);
    expect(sent(["a", "b", "c"], "2")).toEqual(["a:1", "b:1"]);
  });

  it("raises the last member by the dishes past the members", () => {
    expect(sent(["a", "b"], "5")).toEqual(["a:1", "b:4"]);
  });

  it("refuses a count a row of portions cannot be sent at", () => {
    expect(() => sent(["a", "b"], "0")).toThrow(/whole count/);
    expect(() => sent(["a", "b"], "1.5")).toThrow(/whole count/);
  });
});
