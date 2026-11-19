import { sql } from "drizzle-orm";
import { check, foreignKey } from "drizzle-orm/sqlite-core";
import { flag, id, quantity, table, tsString } from "./columns.js";
import { persons } from "./identity/persons.js";
import { workingOrderLines } from "./orders.js";

export const lineServiceCancellations = table(
  "line_service_cancellations",
  {
    lineId: id("line_id").primaryKey(),
    quantity: quantity("quantity").notNull(),
    cancelledAt: tsString("cancelled_at").notNull(),
    wasStarted: flag("was_started").notNull(),
    actorId: id("actor_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.lineId],
      foreignColumns: [workingOrderLines.id],
      name: "line_service_cancellations_line_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.actorId],
      foreignColumns: [persons.id],
      name: "line_service_cancellations_actor_fk",
    }).onDelete("restrict"),
    check("line_service_cancellations_quantity_ck", sql`${t.quantity} > 0`),
  ],
);
