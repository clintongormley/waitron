import { binary, id, table, ts } from "./columns.js";

/**
 * One row per node: everything the box's encrypted archive carries except the database copy,
 * packed and locked with the operator's recovery key (`apps/server/src/sealed-state.ts`), so it
 * travels wherever the database is copied and opens only with that key. Every read and write names
 * the node's id, so a node holding another node's copy of `venue.db` reads its own row or none.
 */
export const nodeSealedState = table("node_sealed_state", {
  // No foreign key to `nodes`: a `local` table holds none into a venue table
  // (`scripts/two-file-foreign-keys.test.ts`). The writer takes the id from the box's own trading
  // configuration.
  nodeId: id("node_id").primaryKey().notNull(),
  sealed: binary("sealed").notNull(),
  updatedAt: ts("updated_at").notNull(),
});
