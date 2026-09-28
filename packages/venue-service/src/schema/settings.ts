import { sql } from "drizzle-orm";
import { check } from "drizzle-orm/sqlite-core";
import { count, enumCheck, enumType, flag, table } from "@waitron/db";

export const KITCHEN_TICKET_GROUPINGS = ["combined", "separate"] as const;
export type KitchenTicketGrouping = (typeof KITCHEN_TICKET_GROUPINGS)[number];
const kitchenTicketGrouping = enumType(KITCHEN_TICKET_GROUPINGS);

/** The venue's service settings: at most one row, `id` pinned to 1. */
export const serviceSettings = table(
  "service_settings",
  {
    id: count("id").primaryKey().notNull().default(1),
    // "Allow changes to items already sent to the kitchen". Off is for a paper-only kitchen, which
    // never reports that it has started an item.
    editSentLines: flag("edit_sent_lines").notNull().default(true),
    // Finish table leaves the party's tables "needs clearing" until someone marks them cleared.
    clearingWorkflow: flag("clearing_workflow").notNull().default(false),
    // How identical dishes print on a kitchen ticket: one `N x` entry, or N entries of one.
    kitchenTicketGrouping: kitchenTicketGrouping("kitchen_ticket_grouping")
      .notNull()
      .default("combined"),
    printHeldWork: flag("print_held_work").notNull().default(false),
    // How long after the fired work ahead of a held group is served that the group is due. Null is
    // off. No CHECK on the range: adding one to this table makes drizzle rebuild it (as
    // `0006_kitchen_ticket_grouping_check.sql` did), so the management route holds the bound.
    releaseReminderMinutes: count("release_reminder_minutes").default(10),
  },
  (t) => [
    check("service_settings_singleton_ck", sql`${t.id} = 1`),
    check("service_settings_kitchen_ticket_grouping_ck", enumCheck(t.kitchenTicketGrouping)),
  ],
);
