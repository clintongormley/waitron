import type { ExtraSelection } from "./extra-selection.js";
import { addDecimal, decimal, toScale } from "./money.js";
import type { OptionSelection } from "./option-selection.js";
import { QUANTITY_SCALE, stringToThousandths } from "./scales.js";

/** What the draft merge rule (plan D10) reads of a draft line; the server and the till each carry more. */
export interface MergeableDraftLine {
  menuItemId: string;
  variantId: string | null;
  menuVersionId: string | null;
  courseId: string | null;
  note: string | null;
  options: readonly OptionSelection[];
  extras: readonly ExtraSelection[];
  /** A decimal string. */
  quantity: string;
  noMerge: boolean;
}

/**
 * Two lines merge exactly when their keys are equal and not null; null for a line that never merges.
 * A fractional quantity never merges: 0.5 kg and 0.3 kg of fish are two portions the kitchen cooks
 * separately, and one 0.8 kg row would lose that. Options compare as a set and extras picks as a
 * multiset, never by order.
 */
export function draftLineMergeKey(line: MergeableDraftLine): string | null {
  if (line.noMerge || stringToThousandths(line.quantity) % 1000 !== 0) return null;
  const options = [
    ...new Set(line.options.map(({ listId, labelId }) => JSON.stringify([listId, labelId]))),
  ].sort();
  const picks = new Map<string, number>();
  for (const { listId, picks: listPicks } of line.extras) {
    for (const { productId, quantity } of listPicks) {
      const pick = JSON.stringify([listId, productId]);
      picks.set(pick, quantity + (picks.get(pick) ?? 0));
    }
  }
  const extras = [...picks].map((entry) => JSON.stringify(entry)).sort();
  return JSON.stringify([
    line.menuItemId,
    line.variantId,
    line.menuVersionId,
    line.courseId,
    line.note,
    options,
    extras,
  ]);
}

/**
 * Adds each line into the first earlier line that orders the same thing, which keeps its id and
 * position; a merged quantity is written at the quantity scale.
 */
export function normaliseDraftLines<T extends MergeableDraftLine>(lines: readonly T[]): T[] {
  const merged: T[] = [];
  const byKey = new Map<string, number>();
  for (const line of lines) {
    const key = draftLineMergeKey(line);
    if (key !== null) {
      const into = byKey.get(key);
      if (into !== undefined) {
        const kept = merged[into]!;
        const total = addDecimal(decimal(kept.quantity), decimal(line.quantity));
        merged[into] = { ...kept, quantity: toScale(total, QUANTITY_SCALE) };
        continue;
      }
      byKey.set(key, merged.length);
    }
    merged.push(line);
  }
  return merged;
}
