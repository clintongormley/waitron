import { unique } from "drizzle-orm/sqlite-core";
import { count, flag, id, label, newId, nowIso, table, tsString } from "./columns.js";

/**
 * A venue-configured MANUAL service status a table may carry (design §2a) — "Bill requested",
 * "Needs cleaning". Venue-wide config (per-location deferred, design §8), the same shape family as
 * the other config tables (`kitchen_stations`, `floor_zones`). One status is set on a table at a
 * time via `dining_tables.status_id` (a single nullable FK, design §2b); this table is the
 * authorable SET.
 */
export const tableServiceStatuses = table(
  "table_service_statuses",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    // The human label the floor plan shows ("Bill requested", "Needs cleaning"). Unique within a venue.
    label: label("label").notNull(),
    // A floor-plan swatch — a hex ("#ef4444") or a short token ("amber"), app-validated on write
    // (validateStatusColor, apps/server/src/tables.ts). Stored as opaque text; no DB CHECK.
    color: label("color").notNull(),
    // Author-controlled ordering in the editor + the floor-plan picker.
    displayOrder: count("display_order").notNull().default(0),
    active: flag("active").notNull().default(true),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // No two statuses share a label within a venue (design §2a) — the unique `createStatus`/`updateStatus`
    // map to `status.label_taken`.
    unique("table_service_statuses_tenant_label_key").on(t.label),
  ],
);
