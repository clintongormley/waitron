import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { flag, id, quantity, table, tsString } from "./columns.js";
import { workingOrderLines } from "./orders.js";

export const lineServiceCancellations = table(
  "line_service_cancellations",
  {
    lineId: id("line_id").primaryKey(),
    quantity: quantity("quantity").notNull(),
    cancelledAt: tsString("cancelled_at").notNull(),
    wasStarted: flag("was_started").notNull(),
    // No key: persons belongs to identity's migration set, not core.
    actorId: id("actor_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.lineId],
      foreignColumns: [workingOrderLines.id],
      name: "line_service_cancellations_line_fk",
    }).onDelete("cascade"),
    check("line_service_cancellations_quantity_ck", sql`${t.quantity} > 0`),
  ],
);
