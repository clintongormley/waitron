import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { sales } from "./sales.js";

export type InvoiceEmailConsent = {
  statementVersion: string;
  language: string;
  recordedAt: string;
  personId: string;
  contactEmail: string;
  contactPhone?: string;
};
export const invoiceDeliveryMedium = enumType(["email", "a4", "receipt"]);
export const invoiceDeliveryDesignation = enumType(["original", "duplicate"]);
export const invoiceDeliveryStatus = enumType(["queued", "sending", "sent", "failed", "unknown"]);

export const invoiceDeliveries = table(
  "invoice_deliveries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    requestKey: label("request_key").notNull(),
    medium: invoiceDeliveryMedium("medium").notNull(),
    designation: invoiceDeliveryDesignation("designation").notNull(),
    status: invoiceDeliveryStatus("status").notNull().default("queued"),
    generation: count("generation").notNull(),
    attempts: count("attempts").notNull().default(0),
    recipient: label("recipient"),
    consent: json<InvoiceEmailConsent>("consent"),
    // Identity owns persons; the request's authenticated operator establishes this attribution.
    personId: id("person_id").notNull(),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    nextAttemptAt: tsString("next_attempt_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    claimTokenHash: label("claim_token_hash"),
    claimedBy: label("claimed_by"),
    claimedAt: tsString("claimed_at"),
    expiredAt: tsString("expired_at"),
    failureCode: label("failure_code").$type<"transport_failed" | "timeout" | "restart">(),
    reportedOutcome: label("reported_outcome").$type<"sent" | "failed" | "unknown">(),
    reportedAt: tsString("reported_at"),
    reportedFailureCode: label("reported_failure_code").$type<"transport_failed" | "timeout">(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "invoice_deliveries_sale_fk",
    }).onDelete("restrict"),
    uniqueIndex("invoice_deliveries_request_uq").on(t.saleId, t.requestKey),
    uniqueIndex("invoice_deliveries_generation_uq").on(t.saleId, t.generation),
    uniqueIndex("invoice_deliveries_active_uq")
      .on(t.saleId)
      .where(sql`${t.status} in ('queued', 'sending')`),
    check("invoice_deliveries_medium_ck", enumCheck(t.medium)),
    check("invoice_deliveries_designation_ck", enumCheck(t.designation)),
    check("invoice_deliveries_status_ck", enumCheck(t.status)),
    check("invoice_deliveries_generation_ck", sql`${t.generation} > 0`),
    check("invoice_deliveries_attempts_ck", sql`${t.attempts} >= 0`),
    check(
      "invoice_deliveries_email_ck",
      sql`(${t.medium} = 'email') = (${t.recipient} is not null and ${t.consent} is not null)`,
    ),
  ],
);
