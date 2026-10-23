import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, json, newId, nodes, table, ts } from "@waitron/db";
import { registrosFacturacion } from "./registros.js";

/**
 * One row per manager's restart of payments while the box's clock read earlier than its latest
 * record. Declared `appendOnly()` in `../classification.ts`. Nothing writes it yet.
 */
export const clockStopRestarts = table(
  "clock_stop_restarts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    nodeId: id("node_id")
      .notNull()
      .references(() => nodes.id),
    // No foreign key: `persons` is in @waitron/identity's migration set, which this set does not
    // require. Nothing checks that it names a person.
    personId: id("person_id").notNull(),
    restartedAt: ts("restarted_at").notNull(),
    // The reading the manager accepted.
    clockAt: ts("clock_at").notNull(),
    registroId: id("registro_id")
      .notNull()
      .references(() => registrosFacturacion.id),
    recordAt: ts("record_at").notNull(),
    proof: json<unknown>("proof").notNull(),
  },
  (t) => [uniqueIndex("clock_stop_restarts_registro_uq").on(t.registroId)],
);
