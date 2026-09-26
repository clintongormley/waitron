import { check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { enumCheck, enumText, flag, id, newId, now, table, ts } from "./columns.js";
import { sales } from "./sales.js";
import { tills } from "./tenants.js";
import { printers } from "./printers.js";

/**
 * The cash-drawer audit log: one row per drawer open. The kick itself is a separate `drawer` print
 * job; printing a receipt never opens the drawer (CLAUDE.md §5).
 *
 * No trigger refuses an update or a delete: the table is declared with `classify()`, not
 * `appendOnly()`, in `../classification.ts`.
 *
 * `person_id` and `authorized_by` are plain ids with no FK: `persons` is in @waitron/identity's
 * migration set, not the core one.
 */
export const drawerOpens = table(
  "drawer_opens",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tillId: id("till_id")
      /* v8 ignore start */
      .references(() => tills.id),
    /* v8 ignore stop */
    /* v8 ignore start */
    printerId: id("printer_id").references(() => printers.id),
    /* v8 ignore stop */
    personId: id("person_id").notNull(),
    openedAt: ts("opened_at").notNull().$defaultFn(now),
    reason: enumText("reason", ["cash_sale", "manual", "calibration"] as const).notNull(),
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    // Who authorized the open under the location's `drawer_open_policy`; NULL for a `cash_sale` open.
    authorizedBy: id("authorized_by"),
    // A person holding cash.drawer authorized the open on behalf of an operator who does not.
    viaOverride: flag("via_override").notNull().default(false),
  },
  (t) => [
    check("drawer_opens_reason_ck", enumCheck(t.reason)),
    check(
      "drawer_opens_target_ck",
      sql`(${t.reason} = 'calibration' and ${t.printerId} is not null and ${t.tillId} is null and ${t.saleId} is null) or (${t.reason} != 'calibration' and ${t.tillId} is not null)`,
    ),
  ],
);

export type DrawerOpenReason = (typeof drawerOpens.reason.enumValues)[number];
