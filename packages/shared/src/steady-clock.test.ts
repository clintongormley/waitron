import { afterEach, expect, it, vi } from "vitest";
import { steadyNow } from "./steady-clock.js";

afterEach(() => vi.restoreAllMocks());

it("reads elapsed milliseconds independently of the wall clock", () => {
  const elapsed = vi.spyOn(performance, "now").mockReturnValue(1.25);
  vi.spyOn(Date, "now").mockImplementation(() => {
    throw new Error("wall time must not measure an elapsed wait");
  });
  expect(steadyNow()).toBe(1.25);
  elapsed.mockReturnValue(2.5);
  expect(steadyNow()).toBe(2.5);
});
