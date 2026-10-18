import type { GroupRelease } from "../api/client.js";

export interface DraftEntry {
  quantity: string;
  wholeUnits: boolean;
}

/** Indexes refer to the submitted lines, which can be a subset of the outbox. */
export interface DraftGroup {
  release: GroupRelease;
  lineIndexes: number[];
}

/** A weighed or fractional line counts once, whatever its weight or quantity. */
export function itemCount(entry: DraftEntry): number {
  return entry.wholeUnits ? Number(entry.quantity) : 1;
}
