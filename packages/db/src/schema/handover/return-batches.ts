import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey } from "drizzle-orm/sqlite-core";
import { bigCount, id, label, table } from "../columns.js";
import { handoverActivations } from "./activations.js";

export const handoverReturnBatches = table(
  "handover_return_batches",
  {
    operationId: id("operation_id").notNull(),
    inventory: label("inventory").notNull(),
    batchIndex: bigCount("batch_index").notNull(),
    batchCount: bigCount("batch_count").notNull(),
    batchDigest: label("batch_digest").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.operationId, t.inventory, t.batchIndex] }),
    foreignKey({
      columns: [t.operationId],
      foreignColumns: [handoverActivations.operationId],
      name: "handover_return_batches_activation_fk",
    }),
    check(
      "handover_return_batches_bounds_ck",
      sql`typeof(${t.batchIndex}) = 'integer' and typeof(${t.batchCount}) = 'integer' and ${t.batchIndex} >= 0 and ${t.batchIndex} < ${t.batchCount} and ${t.batchCount} <= 9007199254740991`,
    ),
  ],
);
