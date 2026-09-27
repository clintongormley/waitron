import { addDecimal, decimal, QUANTITY_SCALE, stringToThousandths, toScale } from "@waitron/shared";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";

export interface DraftLine {
  id: string;
  menuItemId: string;
  variantId: string | null;
  menuVersionId: string | null;
  options: OptionSelection[];
  extras: ExtraSelection[];
  note: string | null;
  quantity: string;
  courseId: string | null;
  noMerge: boolean;
  unavailable: boolean;
}

export interface Draft {
  id: string;
  visitId: string;
  ownerId: string;
  ownerName: string;
  revision: number;
  lines: DraftLine[];
}

/**
 * Adds each line into the first earlier line that orders the same thing (plan D10), which keeps its
 * id and position. Options compare as a set and extras picks as a multiset, never by order.
 *
 * A fractional quantity never merges: 0.5 kg and 0.3 kg of fish are two portions the kitchen cooks
 * separately, and one 0.8 kg row would lose that.
 */
export function normaliseDraftLines(lines: DraftLine[]): DraftLine[] {
  const merged: DraftLine[] = [];
  const byKey = new Map<string, number>();
  for (const line of lines) {
    const key = mergeKey(line);
    const into = key === null ? undefined : byKey.get(key);
    if (into === undefined) {
      if (key !== null) byKey.set(key, merged.length);
      merged.push(line);
      continue;
    }
    const kept = merged[into]!;
    const total = addDecimal(decimal(kept.quantity), decimal(line.quantity));
    merged[into] = { ...kept, quantity: toScale(total, QUANTITY_SCALE) };
  }
  return merged;
}

/** Null for a line that never merges. */
function mergeKey(line: DraftLine): string | null {
  if (line.noMerge || stringToThousandths(line.quantity) % 1000 !== 0) return null;
  const options = [
    ...new Set(line.options.map(({ listId, labelId }) => JSON.stringify([listId, labelId]))),
  ].sort();
  const picks = new Map<string, number>();
  for (const { listId, picks: listPicks } of line.extras) {
    for (const { productId, quantity } of listPicks) {
      const pick = JSON.stringify([listId, productId]);
      picks.set(pick, (picks.get(pick) ?? 0) + quantity);
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
