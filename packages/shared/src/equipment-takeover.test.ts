import { describe, expect, it } from "vitest";
import { mayTakeOver } from "./equipment-takeover.js";

describe("mayTakeOver", () => {
  it.each([
    ["scan", undefined, true],
    ["scan", false, true],
    ["list", true, true],
    ["list", false, false],
    ["list", undefined, false],
    ["manage", true, false],
    ["manage", undefined, false],
  ] as const)("via %s with takeOver %s answers %s", (via, takeOver, expected) => {
    expect(mayTakeOver(via, takeOver)).toBe(expected);
  });
});
