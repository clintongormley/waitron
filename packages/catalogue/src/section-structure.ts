import type { Transaction } from "@waitron/db";
import { syncMenuOffers } from "./menu-structure.js";
import type { SectionGraph } from "./section-graph.js";

/**
 * Each member write in `sections.ts` calls this once, in the caller's transaction, with the menus
 * whose structure it may have changed and the graph it read before writing. A home layout's tile
 * writes (`home-layouts.ts`) do not: no menu root reaches a layout.
 */
export const onStructureChanged: (
  tx: Transaction,
  menuIds: readonly string[],
  before: SectionGraph,
) => Promise<void> = (tx, menuIds, before) => syncMenuOffers(tx, menuIds, before);
