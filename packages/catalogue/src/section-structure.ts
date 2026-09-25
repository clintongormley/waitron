import type { Transaction } from "@waitron/db";

/**
 * Every member write calls this once, in its own transaction, with the menus whose working structure
 * it may have changed. It does nothing yet; the menus plan's Task 3 makes it sync those menus'
 * offers.
 */
export const onStructureChanged: (
  tx: Transaction,
  menuIds: readonly string[],
) => Promise<void> = async () => {};
