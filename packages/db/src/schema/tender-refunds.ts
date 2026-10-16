import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
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
import { sales, tenders } from "./sales.js";
import { locations } from "./tenants.js";

export const tenderRefundState = enumType(["pending", "completed", "failed"]);
const refundMethod = enumType(["cash", "card"]);

export const tenderRefunds = table(
  "tender_refunds",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    tenderId: id("tender_id").notNull(),
    submissionId: id("submission_id").notNull(),
    fingerprint: label("fingerprint").notNull(),
    appliedAmount: money("applied_amount").notNull(),
    tipAmount: money("tip_amount").notNull().default(0),
    reason: label("reason").notNull(),
    // Persons belong to identity's optional migration set, so these are plain ids, as on bill refunds.
    authorizedBy: id("authorized_by").notNull(),
    requestedBy: id("requested_by").notNull(),
    attestedBy: id("attested_by"),
    attestationNote: label("attestation_note"),
    source: saleSourceColumn("source").notNull(),
    deviceId: id("device_id"),
    nodeId: id("node_id").notNull(),
    locationId: id("location_id").notNull(),
    method: refundMethod("method").notNull(),
    manual: flag("manual").notNull().default(false),
    provider: label("provider"),
    providerPaymentRef: label("provider_payment_ref"),
    state: tenderRefundState("state").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    failedAt: tsString("failed_at"),
    sentAt: tsString("sent_at"),
    sendCount: count("send_count").notNull().default(0),
    refsBeforeSend: labelList("refs_before_send"),
    providerRefundRef: label("provider_refund_ref"),
    providerStatus: tenderRefundState("provider_status"),
    lastLookupAt: tsString("last_lookup_at"),
    nextRetryAt: tsString("next_retry_at"),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "tender_refunds_sale_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenderId],
      foreignColumns: [tenders.id],
      name: "tender_refunds_tender_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.deviceId],
      foreignColumns: [devices.id],
      name: "tender_refunds_device_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.nodeId],
      foreignColumns: [nodes.id],
      name: "tender_refunds_node_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.locationId],
      foreignColumns: [locations.id],
      name: "tender_refunds_location_fk",
    }).onDelete("restrict"),
    unique("tender_refunds_submission_key").on(t.saleId, t.submissionId),
    uniqueIndex("tender_refunds_pending_tender_key")
      .on(t.tenderId)
      .where(sql`${t.state} = 'pending'`),
    uniqueIndex("tender_refunds_pending_capture_key")
      .on(t.provider, t.providerPaymentRef)
      .where(sql`${t.state} = 'pending' and ${t.provider} is not null`),
    uniqueIndex("tender_refunds_provider_event_key")
      .on(t.provider, t.providerPaymentRef, t.providerRefundRef)
      .where(sql`${t.providerRefundRef} is not null`),
    index("tender_refunds_recovery_idx").on(t.state, t.nextRetryAt, t.createdAt, t.id),
    ...originChecks("tender_refunds", t.source, t.deviceId),
    check("tender_refunds_state_ck", enumCheck(t.state)),
    check("tender_refunds_method_ck", enumCheck(t.method)),
    check(
      "tender_refunds_amounts_ck",
      sql`typeof(${t.appliedAmount}) = 'integer' and typeof(${t.tipAmount}) = 'integer' and ${t.appliedAmount} >= 0 and ${t.tipAmount} >= 0 and ${t.appliedAmount} + ${t.tipAmount} between 1 and 99999999999999`,
    ),
    check("tender_refunds_reason_ck", sql`length(trim(${t.reason})) > 0`),
    check(
      "tender_refunds_completed_at_ck",
      sql`(${t.state} = 'completed') = (${t.completedAt} is not null)`,
    ),
    check(
      "tender_refunds_failed_at_ck",
      sql`(${t.state} = 'failed') = (${t.failedAt} is not null)`,
    ),
    check(
      "tender_refunds_sent_ck",
      sql`typeof(${t.sendCount}) = 'integer' and ${t.sendCount} >= 0 and (${t.sendCount} = 0) = (${t.sentAt} is null)`,
    ),
    check(
      "tender_refunds_provider_ck",
      sql`(${t.manual} in (0, 1)) and (${t.method} = 'card' or ${t.manual} = 0) and ((${t.method} = 'card' and ${t.manual} = 0 and coalesce(length(trim(${t.provider})), 0) > 0 and coalesce(length(trim(${t.providerPaymentRef})), 0) > 0) or ((${t.method} = 'cash' or ${t.manual} = 1) and ${t.provider} is null and ${t.providerPaymentRef} is null))`,
    ),
    check("tender_refunds_provider_status_ck", enumCheck(t.providerStatus)),
    check(
      "tender_refunds_refs_ck",
      sql`case when ${t.refsBeforeSend} is null then 1 when json_valid(${t.refsBeforeSend}) then json_type(${t.refsBeforeSend}) = 'array' else 0 end`,
    ),
    check(
      "tender_refunds_attestation_ck",
      sql`(${t.attestedBy} is null) = (${t.attestationNote} is null) and (${t.attestedBy} is null or (${t.state} <> 'pending' and length(trim(${t.attestationNote})) > 0))`,
    ),
  ],
);
