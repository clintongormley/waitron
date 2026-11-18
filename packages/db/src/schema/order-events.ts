import { sql } from "drizzle-orm";
import { check, foreignKey, index } from "drizzle-orm/sqlite-core";
import { enumCheck, enumType, id, json, newId, nowIso, table, tsString } from "./columns.js";
import { devices } from "./devices.js";
import { persons } from "./identity/persons.js";
import { orderDrafts } from "./order-drafts.js";
import { orderGroups } from "./order-groups.js";
import { parties } from "./parties.js";

export const ORDER_EVENT_KINDS = [
  "dish.moved",
  "dish.cancelled",
  "group.submitted",
  "group.joined",
  "group.fired",
  "group.reordered",
  "group.lines_moved",
  "group.removed",
  "draft.created",
  "draft.taken_over",
  "draft.submitted",
  "draft.discarded",
] as const;
const orderEventKind = enumType(ORDER_EVENT_KINDS);

export const orderEvents = table(
  "order_events",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    kind: orderEventKind("kind").notNull(),
    at: tsString("at").notNull().$defaultFn(nowIso),
    actorId: id("actor_id"),
    actorDeviceId: id("actor_device_id"),
    partyId: id("party_id"),
    groupId: id("group_id"),
    draftId: id("draft_id"),
    // Dish events outlive a removed line or working order.
    lineId: id("line_id"),
    fromOrderId: id("from_order_id"),
    toOrderId: id("to_order_id"),
    fromPerson: id("from_person"),
    toPerson: id("to_person"),
    detail: json<Record<string, unknown>>("detail").notNull().default({}),
  },
  (t) => [
    foreignKey({
      columns: [t.actorId],
      foreignColumns: [persons.id],
      name: "order_events_actor_fk",
    }),
    foreignKey({
      columns: [t.actorDeviceId],
      foreignColumns: [devices.id],
      name: "order_events_actor_device_fk",
    }),
    foreignKey({
      columns: [t.partyId],
      foreignColumns: [parties.id],
      name: "order_events_party_fk",
    }),
    foreignKey({
      columns: [t.groupId],
      foreignColumns: [orderGroups.id],
      name: "order_events_group_fk",
    }),
    foreignKey({
      columns: [t.draftId],
      foreignColumns: [orderDrafts.id],
      name: "order_events_draft_fk",
    }),
    foreignKey({
      columns: [t.fromPerson],
      foreignColumns: [persons.id],
      name: "order_events_from_person_fk",
    }),
    foreignKey({
      columns: [t.toPerson],
      foreignColumns: [persons.id],
      name: "order_events_to_person_fk",
    }),
    index("order_events_party_idx").on(t.partyId),
    index("order_events_group_idx").on(t.groupId),
    index("order_events_draft_idx").on(t.draftId),
    check("order_events_kind_ck", enumCheck(t.kind)),
    check(
      "order_events_dish_ck",
      sql`${t.kind} not like 'dish.%' or (
        ${t.lineId} is not null and ${t.fromOrderId} is not null and (
          (${t.kind} = 'dish.moved' and ${t.toOrderId} is not null and ${t.toOrderId} <> ${t.fromOrderId}) or
          (${t.kind} = 'dish.cancelled' and ${t.toOrderId} is null)
        )
      )`,
    ),
    check(
      "order_events_group_ck",
      sql`${t.kind} not like 'group.%' or
        (${t.partyId} is not null and ((${t.actorId} is null) <> (${t.actorDeviceId} is null)))`,
    ),
    check(
      "order_events_draft_ck",
      sql`${t.kind} not like 'draft.%' or
        (${t.draftId} is not null and ${t.actorId} is not null and ${t.toPerson} is not null)`,
    ),
  ],
);
