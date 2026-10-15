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
import { printAgents } from "./print-agents.js";
import { printJobs } from "./print-jobs.js";
import { pagePrinters } from "./page-printers.js";
import { sales } from "./sales.js";

export const invoiceDeliveryMedium = enumType(["email", "a4", "receipt"]);
export const invoiceDeliveryDesignation = enumType(["original", "duplicate"]);
export const invoiceDeliveryStatus = enumType(["queued", "sending", "sent", "failed", "unknown"]);

/**
 * Why an A4 delivery ended without a confirmed print. `printer_disabled`: its office printer was
 * disabled (a waiting delivery fails, one being sent becomes uncertain). `switched`: a waiting one
 * was replaced by paper before any agent took it; an email original is switched the same way, before
 * the email worker takes it. `printer_refused` and `printer_unreachable`: it
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

/** Why the printer is holding an A4 job it has not finished, as its agent last renewed it. */
export const a4HoldCodes = [
  "paper_jam",
  "cover_open",
  "paper_out",
  "tray_missing",
  "ink_or_toner_out",
  "output_full",
  "paused",
  "stopped",
] as const;
export type A4HoldCode = (typeof a4HoldCodes)[number];

export const invoiceDeliveries = table(
  "invoice_deliveries",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id").notNull(),
    /* v8 ignore start */
    printJobId: id("print_job_id").references(() => printJobs.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    pagePrinterId: id("page_printer_id").references(() => pagePrinters.id, {
      onDelete: "restrict",
    }),
    requestKey: label("request_key").notNull(),
    medium: invoiceDeliveryMedium("medium").notNull(),
    designation: invoiceDeliveryDesignation("designation").notNull(),
    status: invoiceDeliveryStatus("status").notNull().default("queued"),
    generation: count("generation").notNull(),
    attempts: count("attempts").notNull().default(0),
    recipient: label("recipient"),
    // A person's "send the email again" made this row: its request key replays only as that action.
    madeByRetry: flag("made_by_retry").notNull().default(false),
    // A print request chose this receipt row's printer. A resend's row stays false: the row of its
    // chain's first job holds the mark (`receiptPrinterWithdrawn`, apps/server).
    printerChosen: flag("printer_chosen").notNull().default(false),
    // Identity owns persons; request actions carry their operator, automatic receipts may lack one.
    personId: id("person_id"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    nextAttemptAt: tsString("next_attempt_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    claimTokenHash: label("claim_token_hash"),
    claimedBy: label("claimed_by"),
    /* v8 ignore start */
    claimedAgentId: id("claimed_agent_id").references(() => printAgents.id),
    /* v8 ignore stop */
    claimedAt: tsString("claimed_at"),
    expiredAt: tsString("expired_at"),
    failureCode: label("failure_code").$type<"transport_failed" | "restart" | A4FailureCode>(),
    reportedOutcome: label("reported_outcome").$type<"sent" | "failed" | "unknown">(),
    reportedAt: tsString("reported_at"),
    reportedFailureCode: label("reported_failure_code").$type<"transport_failed" | A4FailureCode>(),
    // Only a renewal writes it, and a report or an expiry leaves it, so an ended attempt keeps its
    // last hold; the server's `rowAttempt` shows it only on an A4 attempt that is sending or
    // unknown.
    printerHold: label("printer_hold").$type<A4HoldCode>(),
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
    check("invoice_deliveries_attempts_ck", sql`${t.attempts} >= 0`),
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
