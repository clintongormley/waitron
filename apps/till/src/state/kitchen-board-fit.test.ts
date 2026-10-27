import { describe, expect, it } from "vitest";
import type { ColumnKey } from "./kitchen-columns.js";
import { type BoardMeasure, columnsFit } from "./kitchen-board-fit.js";

const FOUR: ColumnKey[] = ["overview", "waiting", "preparing", "ready"];

const board = (width: number, textPx = 14): BoardMeasure => ({
  width,
  textPx,
  remPx: 16,
  tapMinPx: 44,
  gapPx: 12,
});

describe("when a kitchen board's columns fit", () => {
  it.each([
    [14, 905],
    [18, 1103],
  ])("four columns at %i px text need %i px", (textPx, need) => {
    expect(columnsFit(board(need, textPx), FOUR, [])).toBe(true);
    expect(columnsFit(board(need - 1, textPx), FOUR, [])).toBe(false);
  });

  it("three card columns need less", () => {
    const three: ColumnKey[] = ["waiting", "preparing", "ready"];
    expect(columnsFit(board(717), three, [])).toBe(true);
    expect(columnsFit(board(716), three, [])).toBe(false);
  });

  it("a collapsed column takes a strip", () => {
    const collapsed: ColumnKey[] = ["waiting", "preparing"];
    expect(columnsFit(board(531), FOUR, collapsed)).toBe(true);
    expect(columnsFit(board(530), FOUR, collapsed)).toBe(false);
  });

  it("Held as a fifth column", () => {
    const five: ColumnKey[] = ["overview", "held", "waiting", "preparing", "ready"];
    expect(columnsFit(board(1148), five, [])).toBe(true);
    expect(columnsFit(board(1147), five, [])).toBe(false);
  });

  it("nothing shown always fits", () => {
    expect(columnsFit(board(0), [], [])).toBe(true);
  });
});
