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
import { visits } from "./visits.js";

export const orderDraftState = enumType(["open", "submitted", "discarded"]);

/**
 * One operator's unsent order on a visit (`apps/server/src/order-drafts.ts`). The partial unique
 * index allows each person one OPEN draft per visit. Drafts are never deleted, because their events
 * point at them.
 *
 * `owner_id` is a plain person id with no key: `persons` is in @waitron/identity's migration set,
 * not the core one.
 */
export const orderDrafts = table(
  "order_drafts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    visitId: id("visit_id").notNull(),
    ownerId: id("owner_id").notNull(),
    revision: count("revision").notNull().default(0),
    state: orderDraftState("state").notNull().default("open"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    foreignKey({
      columns: [t.visitId],
      foreignColumns: [visits.id],
      name: "order_drafts_visit_fk",
    }),
    index("order_drafts_visit_idx").on(t.visitId),
    uniqueIndex("order_drafts_open_owner_uq")
      .on(t.visitId, t.ownerId)
      .where(sql`${t.state} = 'open'`),
    check("order_drafts_state_ck", enumCheck(t.state)),
  ],
);

/**
 * One line of a draft, as the till last saved it: what a basket line names, before pricing. No
 * author column: the whole draft is credited to its owner when it is submitted.
 */
export const orderDraftLines = table(
  "order_draft_lines",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    draftId: id("draft_id").notNull(),
    // No unique index, for the reason `order_groups.position` states.
    position: count("position").notNull(),
    // No key: `menu_items` is in the catalogue module's migration set; pricing at submission
    // refuses a menu item the zone does not offer.
    menuItemId: id("menu_item_id").notNull(),
    variantId: id("variant_id"),
    menuVersionId: id("menu_version_id"),
    options: json<OptionSelection[]>("options").notNull(),
    extras: json<ExtraSelection[]>("extras").notNull(),
    note: label("note"),
    quantity: quantity("quantity").notNull(),
    courseId: id("course_id"),
    // `normaliseDraftLines` never adds this row to a matching one.
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
    index("order_draft_lines_draft_idx").on(t.draftId),
    check("order_draft_lines_quantity_ck", sql`${t.quantity} > 0`),
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
