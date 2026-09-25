import type { Transaction } from "@waitron/db";

/**
 * Every member write calls this once, in the caller's transaction, with the menus whose structure
 * it may have changed.
 */
export const onStructureChanged: (
  tx: Transaction,
  menuIds: readonly string[],
) => Promise<void> = async () => {};
