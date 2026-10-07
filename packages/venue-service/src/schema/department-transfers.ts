import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  deviceProfiles,
  enumCheck,
  enumType,
  floorZones,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
  workingOrders,
} from "@waitron/db";
import { departments } from "./service.js";

export const departmentTransferDesks = table(
  "department_transfer_desks",
  {
    departmentId: id("department_id").primaryKey(),
    receivingProfileId: id("receiving_profile_id").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.departmentId],
      foreignColumns: [departments.id],
      name: "department_transfer_desks_department_fk",
    }),
    foreignKey({
      columns: [t.receivingProfileId],
      foreignColumns: [deviceProfiles.id],
      name: "department_transfer_desks_profile_fk",
    }).onDelete("cascade"),
  ],
);

export const departmentTransferDestinations = table(
  "department_transfer_destinations",
  {
    sourceDepartmentId: id("source_department_id").notNull(),
    destinationDepartmentId: id("destination_department_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.sourceDepartmentId, t.destinationDepartmentId],
      name: "department_transfer_destinations_pk",
    }),
    foreignKey({
      columns: [t.sourceDepartmentId],
      foreignColumns: [departments.id],
      name: "department_transfer_destinations_source_fk",
    }),
    foreignKey({
      columns: [t.destinationDepartmentId],
      foreignColumns: [departments.id],
      name: "department_transfer_destinations_destination_fk",
    }),
    check(
      "department_transfer_destinations_different_ck",
      sql`${t.sourceDepartmentId} <> ${t.destinationDepartmentId}`,
    ),
  ],
);

const transferStatus = enumType(["pending", "accepted", "declined", "withdrawn"]);

export const departmentTransferRequests = table(
  "department_transfer_requests",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    tabId: id("tab_id").notNull(),
    sourceDepartmentId: id("source_department_id").notNull(),
    destinationDepartmentId: id("destination_department_id").notNull(),
    // Person ids have no key into identity's migration set.
    senderId: id("sender_id").notNull(),
    resolvedBy: id("resolved_by"),
    destinationZoneId: id("destination_zone_id"),
    status: transferStatus("status").notNull().default("pending"),
    reason: label("reason"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    resolvedAt: tsString("resolved_at"),
    revision: count("revision").notNull().default(0),
  },
  (t) => [
    foreignKey({
      columns: [t.tabId],
      foreignColumns: [workingOrders.id],
      name: "department_transfer_requests_tab_fk",
    }),
    foreignKey({
      columns: [t.sourceDepartmentId],
      foreignColumns: [departments.id],
      name: "department_transfer_requests_source_fk",
    }),
    foreignKey({
      columns: [t.destinationDepartmentId],
      foreignColumns: [departments.id],
      name: "department_transfer_requests_destination_fk",
    }),
    foreignKey({
      columns: [t.destinationZoneId],
      foreignColumns: [floorZones.id],
      name: "department_transfer_requests_zone_fk",
    }),
    uniqueIndex("department_transfer_requests_one_pending_key")
      .on(t.tabId)
      .where(sql`${t.status} = 'pending'`),
    check("department_transfer_requests_status_ck", enumCheck(t.status)),
    check(
      "department_transfer_requests_different_ck",
      sql`${t.sourceDepartmentId} <> ${t.destinationDepartmentId}`,
    ),
    check(
      "department_transfer_requests_resolved_ck",
      sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)`,
    ),
    check(
      "department_transfer_requests_decline_reason_ck",
      sql`${t.status} <> 'declined' or (${t.reason} is not null and length(trim(${t.reason})) > 0)`,
    ),
  ],
);
