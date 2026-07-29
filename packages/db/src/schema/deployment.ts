import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** One row, id pinned to 1 — see 0010_deployment_stamp.sql for why a second row must be impossible. */
export const deployment = pgTable(
  "deployment",
  {
    id: integer("id").primaryKey(),
    environment: text("environment").notNull(),
    stampedAt: timestamp("stamped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("deployment_singleton_ck", sql`${t.id} = 1`)],
);
