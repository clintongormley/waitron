import type { ColumnKey } from "./kitchen-columns.js";

/** A board's width and the sizes its columns are measured in, all in px. */
export interface BoardMeasure {
  width: number;
  textPx: number;
  remPx: number;
  tapMinPx: number;
  gapPx: number;
}

/** An open card column holds a 22-character dish line whole, measured at 14 and 18 px text (plan slice 9c D7). */
export const CARD_COLUMN_TEXT_WIDTHS = 16.5;

/** `.column`'s flex basis in `station-queue.ts`, which Overview keeps and does not grow past. */
export const OVERVIEW_COLUMN_REMS = 11;

/** Whether the shown columns, in order, fit side by side; `collapsed` among them take a strip. */
export function columnsFit(
  board: BoardMeasure,
  shown: readonly ColumnKey[],
  collapsed: readonly ColumnKey[],
): boolean {
  if (shown.length === 0) return true;
  let need = board.gapPx * (shown.length - 1);
  for (const key of shown) {
    if (collapsed.includes(key)) need += board.tapMinPx;
    else if (key === "overview") need += OVERVIEW_COLUMN_REMS * board.remPx;
    else need += CARD_COLUMN_TEXT_WIDTHS * board.textPx;
  }
  return board.width >= need;
}
