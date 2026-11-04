import { sql } from "drizzle-orm";
import { check, index, uniqueIndex } from "drizzle-orm/sqlite-core";
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
import { pagePrinters } from "./page-printers.js";
import { printAgents } from "./print-agents.js";
import { sales } from "./sales.js";
import {
  invoiceDeliveryDesignation,
  invoiceDeliveryStatus,
  type A4FailureCode,
  type A4HoldCode,
} from "./invoice-deliveries.js";

export const documentPageOutcome = enumType(["sent", "failed", "unknown"]);
export const documentPageJobs = table(
  "document_page_jobs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    pagePrinterId: id("page_printer_id")
      .notNull()
      .references(() => pagePrinters.id, { onDelete: "restrict" }),
    language: label("language").notNull(),
    designation: invoiceDeliveryDesignation("designation").notNull(),
    // Identity owns people; removal must not erase the requesting operator's attribution.
    personId: id("person_id").notNull(),
    status: invoiceDeliveryStatus("status").notNull().default("queued"),
    generation: count("generation").notNull().default(1),
    attempts: count("attempts").notNull().default(0),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    completedAt: tsString("completed_at"),
    claimTokenHash: label("claim_token_hash"),
    claimedBy: label("claimed_by"),
    claimedAgentId: id("claimed_agent_id").references(() => printAgents.id, {
      onDelete: "restrict",
    }),
    claimedAt: tsString("claimed_at"),
    expiredAt: tsString("expired_at"),
    failureCode: label("failure_code").$type<"restart" | A4FailureCode>(),
    reportedOutcome: documentPageOutcome("reported_outcome"),
    reportedAt: tsString("reported_at"),
    reportedFailureCode: label("reported_failure_code").$type<A4FailureCode>(),
    printerHold: label("printer_hold").$type<A4HoldCode>(),
    receiptHandover: json<{ personId: string; confirmedAt: string }>("receipt_handover"),
  },
  (t) => [
    index("document_page_jobs_claim_idx").on(t.pagePrinterId, t.status),
    index("document_page_jobs_sale_idx").on(t.saleId),
    check("document_page_jobs_status_ck", enumCheck(t.status)),
    check("document_page_jobs_designation_ck", enumCheck(t.designation)),
    check("document_page_jobs_outcome_ck", enumCheck(t.reportedOutcome)),
    check(
      "document_page_jobs_generation_ck",
      sql`${t.generation} between 1 and 9007199254740991 and ${t.generation} = cast(${t.generation} as integer)`,
    ),
    check(
      "document_page_jobs_attempts_ck",
      sql`${t.attempts} between 0 and 9007199254740991 and ${t.attempts} = cast(${t.attempts} as integer)`,
    ),
  ],
);

export const documentPageReprints = table(
  "document_page_reprints",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    saleId: id("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "restrict" }),
    pageJobId: id("page_job_id")
      .notNull()
      .references(() => documentPageJobs.id, { onDelete: "restrict" }),
    // Identity owns people; removal must not erase the requesting operator's attribution.
    personId: id("person_id").notNull(),
    requestedAt: tsString("requested_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("document_page_reprints_job_uq").on(t.pageJobId),
    index("document_page_reprints_sale_idx").on(t.saleId),
  ],
);
