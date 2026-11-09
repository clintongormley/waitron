import { sql } from "drizzle-orm";
import { check, index, primaryKey } from "drizzle-orm/sqlite-core";
import type { DeliveryContext, InvoiceSave, InvoiceSaveResult } from "@waitron/shared";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  nowIso,
  table,
  tsString,
} from "./columns.js";

export const deviceInvoiceSaveStatus = enumType(["prepared", "saved", "refused", "fenced"]);

export const deviceInvoiceSaveOperations = table(
  "device_invoice_save_operations",
  {
    nodeId: id("node_id").notNull(),
    recoveryEpoch: id("recovery_epoch").notNull(),
    saveId: id("save_id").notNull(),
    // Admission must validate these targets; local protocol rows have no cross-class foreign keys.
    deviceId: id("device_id").notNull(),
    personId: id("person_id").notNull(),
    sessionId: id("session_id").notNull(),
    context: json<DeliveryContext>("context").notNull(),
    expectedRevision: count("expected_revision").notNull(),
    selection: json<InvoiceSave["selection"]>("selection").notNull(),
    managementEdit: json<Record<string, unknown>>("management_edit"),
    canonicalIntent: label("canonical_intent").notNull(),
    fingerprint: label("fingerprint").notNull(),
    status: deviceInvoiceSaveStatus("status").notNull(),
    savedResult: json<InvoiceSaveResult>("saved_result"),
    refusalCode: label("refusal_code"),
    acknowledged: flag("acknowledged").notNull().default(false),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    updatedAt: tsString("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.nodeId, t.recoveryEpoch, t.saveId] }),
    index("device_invoice_save_operations_recovery_idx").on(
      t.nodeId,
      t.recoveryEpoch,
      t.deviceId,
      t.acknowledged,
    ),
    check("device_invoice_save_operations_status_ck", enumCheck(t.status)),
    check(
      "device_invoice_save_operations_revision_ck",
      sql`${t.expectedRevision} between 0 and 9007199254740991 and ${t.expectedRevision} = cast(${t.expectedRevision} as integer)`,
    ),
  ],
);
