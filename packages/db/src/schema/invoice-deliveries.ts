import { sql } from "drizzle-orm";
import { check, foreignKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  count,
  enumCheck,
  enumType,
  flag,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { persons } from "./identity/persons.js";
import { printHoldCodes, printJobs } from "./print-jobs.js";
import { printers } from "./printers.js";
import { sales } from "./sales.js";

export { printHoldCodes as a4HoldCodes };
export type A4HoldCode = (typeof printHoldCodes)[number];

export const invoiceDeliveryMedium = enumType(["email", "a4", "receipt"]);
export const invoiceDeliveryDesignation = enumType(["original", "duplicate"]);
export const invoiceDeliveryStatus = enumType(["queued", "sending", "sent", "failed", "unknown"]);

/**
 * Why an A4 delivery ended without a confirmed print. `printer_disabled`: its office printer was
 * disabled (a waiting delivery fails, one being sent becomes uncertain). `switched`: a waiting one
 * was replaced by paper before any agent took it; an email original is switched the same way, before
 * the mail job takes it. `printer_refused` and `printer_unreachable`: it
 * did not print (failed). `printer_aborted` (stopped after the printer accepted it) and `timeout`:
 * it may have printed (uncertain). `document_unavailable`: the agent could not get the invoice's pages, so
 * nothing was sent to the printer (failed).
 */
export const a4FailureCodes = [
  "printer_disabled",
  "switched",
  "printer_refused",
  "printer_unreachable",
  "printer_aborted",
  "timeout",
  "document_unavailable",
] as const;
export type A4FailureCode = (typeof a4FailureCodes)[number];

export const invoiceDeliveries = table(
  "invoice_deliveries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    /* v8 ignore start */
    printJobId: id("print_job_id").references(() => printJobs.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    printerId: id("printer_id").references(() => printers.id, {
      onDelete: "restrict",
    }),
    requestKey: label("request_key").notNull(),
    medium: invoiceDeliveryMedium("medium").notNull(),
    designation: invoiceDeliveryDesignation("designation").notNull(),
    status: invoiceDeliveryStatus("status").notNull().default("queued"),
    generation: count("generation").notNull(),
    recipient: label("recipient"),
    // A person's "send the email again" made this row: its request key replays only as that action.
    madeByRetry: flag("made_by_retry").notNull().default(false),
    // A print request chose this receipt row's printer. A resend's own row stays false; a resend
    // that takes the row over keeps the mark (`receiptPrinterWithdrawn`, apps/server).
    printerChosen: flag("printer_chosen").notNull().default(false),
    // Automatic receipts may lack an operator.
    personId: id("person_id").references(() => persons.id),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    expiredAt: tsString("expired_at"),
    failureCode: label("failure_code").$type<"transport_failed" | "restart" | A4FailureCode>(),
    reportedOutcome: label("reported_outcome").$type<"sent" | "failed" | "unknown">(),
    reportedAt: tsString("reported_at"),
    reportedFailureCode: label("reported_failure_code").$type<"transport_failed" | A4FailureCode>(),
  },
  (t) => [
    foreignKey({
      columns: [t.saleId],
      foreignColumns: [sales.id],
      name: "invoice_deliveries_sale_fk",
    }).onDelete("restrict"),
    uniqueIndex("invoice_deliveries_print_job_uq").on(t.printJobId),
    uniqueIndex("invoice_deliveries_request_uq").on(t.saleId, t.requestKey),
    uniqueIndex("invoice_deliveries_generation_uq").on(t.saleId, t.generation),
    uniqueIndex("invoice_deliveries_active_uq")
      .on(t.saleId)
      .where(sql`${t.status} in ('queued', 'sending')`),
    check("invoice_deliveries_medium_ck", enumCheck(t.medium)),
    check("invoice_deliveries_designation_ck", enumCheck(t.designation)),
    check("invoice_deliveries_status_ck", enumCheck(t.status)),
    check("invoice_deliveries_generation_ck", sql`${t.generation} > 0`),
    check(
      "invoice_deliveries_person_ck",
      sql`${t.personId} is not null or ${t.medium} = 'receipt'`,
    ),
    check(
      "invoice_deliveries_email_ck",
      sql`(${t.medium} = 'email') = (${t.recipient} is not null)`,
    ),
  ],
);
