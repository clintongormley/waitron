import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { count, id, newId, table } from "./columns.js";
import { orderDrafts } from "./order-drafts.js";
import { orderGroups } from "./order-groups.js";
import { workingOrderLines } from "./orders.js";

export const orderDraftRecalledLines = table(
  "order_draft_recalled_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    draftId: id("draft_id").notNull(),
    sourceLineId: id("source_line_id").notNull(),
    position: count("position").notNull(),
    slot: count("slot").notNull().default(0),
    joinGroupId: id("join_group_id"),
    afterGroupId: id("after_group_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [orderDrafts.id],
      name: "order_draft_recalled_lines_draft_fk",
    }),
    foreignKey({
      columns: [t.sourceLineId],
      foreignColumns: [workingOrderLines.id],
      name: "order_draft_recalled_lines_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.joinGroupId],
      foreignColumns: [orderGroups.id],
      name: "order_draft_recalled_lines_join_group_fk",
    }),
    foreignKey({
      columns: [t.afterGroupId],
      foreignColumns: [orderGroups.id],
      name: "order_draft_recalled_lines_after_group_fk",
    }),
    uniqueIndex("order_draft_recalled_lines_source_uq").on(t.sourceLineId),
    index("order_draft_recalled_lines_draft_idx").on(t.draftId),
    check("order_draft_recalled_lines_slot_ck", sql`${t.slot} >= 0`),
    check("order_draft_recalled_lines_place_ck", sql`${t.joinGroupId} is null or ${t.slot} = 0`),
    check("order_draft_recalled_lines_after_ck", sql`${t.afterGroupId} is null or ${t.slot} >= 1`),
  ],
);
