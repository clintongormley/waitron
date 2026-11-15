import { describe, expect, it } from "vitest";
import { normalisePrefix } from "./index.js";

describe("the configured bucket prefix", () => {
  it.each([
    ["", ""],
    ["/", ""],
    ["waitron", "waitron/"],
    ["/waitron/", "waitron/"],
    ["//a/b//", "a/b/"],
    ["a//b", "a//b/"],
    [" /a/ ", " /a/ /"],
  ])("normalises %j to %j", (prefix, expected) => {
    expect(normalisePrefix(prefix)).toBe(expected);
  });

  it("normalises a crafted 200,000-character prefix within one second", () => {
    const inner = "/".repeat(200_000);
    const started = performance.now();
    expect(normalisePrefix(`x${inner}y`)).toBe(`x${inner}y/`);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
