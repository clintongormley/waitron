import type { Transaction } from "@waitron/db";
import { mergeMembers } from "./floor-today-merges.js";
import {
  enqueueMovedSlipsFor,
  readPartiesSentWork,
  readSentWorkAt,
  type SentWork,
} from "./kitchen-print.js";
import type { TillConfig } from "./till-config.js";

// Function declarations and types only: this module sits in import loops, so top-level code
// calling an import could run first.

/** Set by a caller that tells the kitchen itself once its work is done: each bill merged away is recorded, by the bill it merged into. */
export interface SlipsLater {
  mergedInto: Map<string, string>;
}

/**
 * Whose sent work a write may move: the parties at `tables` (and the orders delivered to them),
 * widened by `targetGroupOf`'s merge members; `parties` and the orders delivered to `deliveredTo`;
 * or `later`, an outer call that snapshots and tells the kitchen itself.
 */
export type MovedSlipsReach =
  | { tables: readonly string[]; targetGroupOf?: string }
  | { parties: readonly string[]; deliveredTo?: readonly string[] }
  | { later: SlipsLater };

/**
 * Reads the sent work `reach` names, runs `write`, then queues a MOVED slip for whatever of it
 * moved. A `null` reach runs `write` and queues nothing. The `SlipsLater` handed to `write` is
 * for inner calls to report into; a `null` reach's must not be passed down, or inner actions
 * stop telling the kitchen and nothing queues their slips.
 */
export async function withMovedSlips<T>(
  tx: Transaction,
  cfg: TillConfig,
  reach: MovedSlipsReach | null,
  write: (slips: SlipsLater) => Promise<T>,
): Promise<T> {
  if (reach !== null && "later" in reach) return write(reach.later);
  const before = reach === null ? null : await sentWorkIn(tx, reach);
  const slips: SlipsLater = { mergedInto: new Map() };
  const result = await write(slips);
  if (before !== null) await enqueueMovedSlipsFor(tx, cfg, before, slips.mergedInto);
  return result;
}

async function sentWorkIn(
  tx: Transaction,
  reach: Exclude<MovedSlipsReach, { later: SlipsLater }>,
): Promise<Map<string, SentWork>> {
  if ("parties" in reach) return readPartiesSentWork(tx, reach.parties, reach.deliveredTo);
  const group =
    reach.targetGroupOf === undefined ? [] : await mergeMembers(tx, reach.targetGroupOf);
  return readSentWorkAt(tx, [...new Set([...reach.tables, ...group])]);
}
