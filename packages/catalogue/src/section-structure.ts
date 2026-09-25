import type { Transaction } from "@waitron/db";
import { syncMenuOffers } from "./menu-structure.js";
import type { SectionGraph } from "./section-graph.js";

/**
 * Every member write calls this once, in the caller's transaction, with the menus whose structure
 * it may have changed and the graph it read before writing.
 */
export const onStructureChanged: (
  tx: Transaction,
  menuIds: readonly string[],
  before: SectionGraph,
) => Promise<void> = (tx, menuIds, before) => syncMenuOffers(tx, menuIds, before);
