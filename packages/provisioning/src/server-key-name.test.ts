import { randomInt } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { newBreakGlassKeyName } from "./index.js";

vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const drawCodeIndex = vi.mocked(randomInt as (max: number) => number);

afterEach(() => {
  drawCodeIndex.mockReset();
});

it("names a key by its day and four characters from its alphabet", () => {
  expect(newBreakGlassKeyName("2026-10-15", new Set())).toMatch(
    /^2026-10-15 · [34679ACDEFHJKMNPQRTUVWXY]{4}$/,
  );
});

it("draws again until the name is none of those it is told are taken", () => {
  for (const index of [0, 0, 0, 0, 1, 1, 1, 1, 23, 23, 23, 23])
    drawCodeIndex.mockReturnValueOnce(index);
  const taken = new Set(["2026-10-15 · 3333", "2026-10-15 · 4444"]);
  expect(newBreakGlassKeyName("2026-10-15", taken)).toBe("2026-10-15 · YYYY");
});
