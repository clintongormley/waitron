import { describe, expect, it } from "vitest";
import { tillProviderForReader } from "./till-card-provider.js";

describe("tillProviderForReader", () => {
  it.each([
    ["sumup", "sumup_cloud"],
    ["stripe", "stripe_terminal"],
    ["simulator", undefined],
    ["", undefined],
    [undefined, undefined],
  ] as const)("maps %s to %s", (stored, expected) => {
    expect(tillProviderForReader(stored)).toBe(expected);
  });
});
