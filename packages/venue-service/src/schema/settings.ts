import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, flag, table } from "@waitron/db";

/** The venue's service settings: at most one row, `id` pinned to 1. */
export const serviceSettings = table(
  "service_settings",
  {
    id: count("id").primaryKey().notNull().default(1),
    // "Allow changes to items already sent to the kitchen". Off is for a paper-only kitchen, which
    // never reports that it has started an item.
    editSentLines: flag("edit_sent_lines").notNull().default(true),
  },
  (t) => [check("service_settings_singleton_ck", sql`${t.id} = 1`)],
);
