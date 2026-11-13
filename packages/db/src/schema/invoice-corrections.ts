import { sql } from "drizzle-orm";
import { check, foreignKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  enumCheck,
  enumType,
  flag,
  id,
  label,
  labelList,
  money,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { devices } from "./devices.js";
import { nodes } from "./nodes.js";
import { originChecks, saleSourceColumn } from "./origin.js";
import { sales } from "./sales.js";

export const invoiceCorrectionState = enumType(["open", "filed", "discarded", "closed"]);

export const invoiceCorrections = table(
  "invoice_corrections",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    originalSaleId: id("original_sale_id").notNull(),
    submissionId: id("submission_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    gross: money("gross").notNull(),
    // Null when the correction names no lines.
    lineIds: labelList("line_ids"),
    reason: label("reason").notNull(),
    // Plain ids, as on bill refunds: no key yet.
    requestedBy: id("requested_by").notNull(),
    authorizedBy: id("authorized_by").notNull(),
    viaOverride: flag("via_override").notNull(),
    source: saleSourceColumn("source").notNull(),
    deviceId: id("device_id"),
    nodeId: id("node_id").notNull(),
    state: invoiceCorrectionState("state").notNull(),
    correctiveSaleId: id("corrective_sale_id"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    endedAt: tsString("ended_at"),
    // Plain ids, as on bill refunds: no key yet.
    endedBy: id("ended_by"),
  },
  (t) => [
    foreignKey({
      columns: [t.originalSaleId],
      foreignColumns: [sales.id],
      name: "invoice_corrections_original_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.correctiveSaleId],
      foreignColumns: [sales.id],
      name: "invoice_corrections_corrective_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "invoice_corrections_device_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "invoice_corrections_node_fk",
    }).onDelete("restrict"),
    unique("invoice_corrections_submission_key").on(t.originalSaleId, t.submissionId),
    uniqueIndex("invoice_corrections_open_key")
      .on(t.originalSaleId)
      .where(sql`${t.state} = 'open'`),
    ...originChecks("invoice_corrections", t.source, t.deviceId),
    check("invoice_corrections_state_ck", enumCheck(t.state)),
    check("invoice_corrections_gross_ck", sql`typeof(${t.gross}) = 'integer' and ${t.gross} > 0`),
    check(
      "invoice_corrections_filed_ck",
      sql`(${t.state} = 'filed') = (${t.correctiveSaleId} is not null)`,
    ),
    check("invoice_corrections_ended_ck", sql`(${t.state} = 'open') = (${t.endedAt} is null)`),
    check(
      "invoice_corrections_ended_by_ck",
      sql`(${t.state} <> 'open' or ${t.endedBy} is null) and (${t.state} not in ('discarded', 'closed') or ${t.endedBy} is not null)`,
    ),
  ],
);
