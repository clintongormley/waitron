import type { Transaction } from "@waitron/db";
import { syncMenuOffers } from "./menu-structure.js";

/**
 * Every member write calls this once, in the caller's transaction, with the menus whose structure
 * it may have changed. A write that removes links passes the menus it worked out before the
 * delete, because the cascade takes away the links they are found through.
 */
export const onStructureChanged: (tx: Transaction, menuIds: readonly string[]) => Promise<void> = (
  tx,
  menuIds,
) => syncMenuOffers(tx, menuIds);
