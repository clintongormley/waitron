import { id, label, now, table, ts } from "@waitron/db";

/** A scrypt verifier of this box's offline recovery key, never the key itself. */
export const nodeRecoveryKey = table("node_recovery_key", {
  nodeId: id("node_id").primaryKey(),
  verifier: label("verifier").notNull(),
  keyName: label("key_name").notNull(),
  updatedAt: ts("updated_at").notNull().$defaultFn(now),
});
