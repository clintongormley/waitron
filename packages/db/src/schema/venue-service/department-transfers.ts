import { sql } from "drizzle-orm";
import { check, foreignKey, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "../columns.js";
import { floorZones } from "../floor-zones.js";
import { persons } from "../identity/persons.js";
import { workingOrders } from "../orders.js";
import { departments } from "./service.js";

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
    foreignKey({
      columns: [t.senderId],
      foreignColumns: [persons.id],
      name: "department_transfer_requests_sender_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.resolvedBy],
      foreignColumns: [persons.id],
      name: "department_transfer_requests_resolved_by_fk",
    }).onDelete("restrict"),
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
