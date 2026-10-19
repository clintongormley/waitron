import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  newId,
  nowIso,
  quantity,
  table,
  tsString,
} from "./columns.js";
import { kitchenCourses } from "./kitchen-courses.js";
import { kitchenStations } from "./kitchen-stations.js";
import { orderGroups } from "./order-groups.js";
import { workingOrders } from "./orders.js";
import { parties } from "./parties.js";

export const orderDraftState = enumType(["open", "submitted", "discarded"]);

// owner_id has no key because persons belongs to the identity module's migration set.
export const orderDrafts = table(
  "order_drafts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    partyId: id("party_id").notNull(),
    billId: id("bill_id"),
    ownerId: id("owner_id").notNull(),
    revision: count("revision").notNull().default(0),
    state: orderDraftState("state").notNull().default("open"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "order_drafts_party_fk",
    }),
    foreignKey({
      columns: [t.billId],
      foreignColumns: [workingOrders.id],
      name: "order_drafts_bill_fk",
    }),
    index("order_drafts_party_idx").on(t.partyId),
    uniqueIndex("order_drafts_open_owner_uq")
      .on(t.billId)
      .where(sql`${t.state} = 'open'`),
    check("order_drafts_state_ck", enumCheck(t.state)),
  ],
);

export const orderDraftLines = table(
  "order_draft_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    draftId: id("draft_id").notNull(),
    position: count("position").notNull(),
    // No key: `menu_items` is in the catalogue module's migration set.
    menuItemId: id("menu_item_id").notNull(),
    variantId: id("variant_id"),
    menuVersionId: id("menu_version_id"),
    options: json<OptionSelection[]>("options").notNull(),
    extras: json<ExtraSelection[]>("extras").notNull(),
    note: label("note"),
    quantity: quantity("quantity").notNull(),
    courseId: id("course_id"),
    makeAtStationId: id("make_at_station_id"),
    // Fire now is slot 0; a join keeps 0, and a new held group uses a positive slot.
    slot: count("slot").notNull().default(0),
    joinGroupId: id("join_group_id"),
    afterGroupId: id("after_group_id"),
    // `normaliseDraftLines` never adds this row to another, nor another to it.
    noMerge: flag("no_merge").notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [orderDrafts.id],
      name: "order_draft_lines_draft_fk",
    }),
    foreignKey({
      columns: [t.courseId],
      foreignColumns: [kitchenCourses.id],
      name: "order_draft_lines_course_fk",
    }),
    foreignKey({
      columns: [t.makeAtStationId],
      foreignColumns: [kitchenStations.id],
      name: "order_draft_lines_make_at_station_fk",
    }),
    foreignKey({
      columns: [t.joinGroupId],
      foreignColumns: [orderGroups.id],
      name: "order_draft_lines_join_group_fk",
    }),
    foreignKey({
      columns: [t.afterGroupId],
      foreignColumns: [orderGroups.id],
      name: "order_draft_lines_after_group_fk",
    }),
    index("order_draft_lines_draft_idx").on(t.draftId),
    index("order_draft_lines_course_idx").on(t.courseId),
    check("order_draft_lines_quantity_ck", sql`${t.quantity} > 0`),
    check("order_draft_lines_slot_ck", sql`${t.slot} >= 0`),
    check("order_draft_lines_place_ck", sql`${t.joinGroupId} is null or ${t.slot} = 0`),
    check("order_draft_lines_after_ck", sql`${t.afterGroupId} is null or ${t.slot} >= 1`),
  ],
);

export const orderDraftEventKind = enumType(["created", "taken_over", "submitted", "discarded"]);

/**
 * Who owned a draft, and what became of it. Declared `appendOnly()` in `../classification.ts`.
 *
 * `to_person` is the owner after the event; `from_person` is the owner before it, null on
 * `created`. Both, and `actor_id`, are plain person ids, as `order_drafts.owner_id` is.
 */
export const orderDraftEvents = table(
  "order_draft_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    draftId: id("draft_id").notNull(),
    kind: orderDraftEventKind("kind").notNull(),
    fromPerson: id("from_person"),
    toPerson: id("to_person").notNull(),
    actorId: id("actor_id").notNull(),
    detail: json<Record<string, unknown>>("detail").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [orderDrafts.id],
      name: "order_draft_events_draft_fk",
    }),
    index("order_draft_events_draft_idx").on(t.draftId),
    check("order_draft_events_kind_ck", enumCheck(t.kind)),
  ],
);
