import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, newId, nodes, table, ts } from "@waitron/db";
import { verifactuRecords } from "./verifactu-records.js";

export const clockStopRestarts = table(
  "clock_stop_restarts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    // This legacy table has no product writer. The person id has no foreign key.
    personId: id("person_id").notNull(),
    restartedAt: ts("restarted_at").notNull(),
    // The reading the manager accepted.
    clockAt: ts("clock_at").notNull(),
    registroId: id("registro_id")
      .notNull()
      .references(() => verifactuRecords.id),
    recordAt: ts("record_at").notNull(),
    proof: json<unknown>("proof").notNull(),
  },
  (t) => [uniqueIndex("clock_stop_restarts_registro_uq").on(t.registroId)],
);
