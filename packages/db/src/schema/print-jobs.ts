import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  binary,
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
import { printAgents } from "./print-agents.js";
import { printers } from "./printers.js";
import { sales } from "./sales.js";
import { refunds } from "./refunds.js";

/** Why the printer is holding an A4 job it has not finished, as its agent last renewed it. */
export const printHoldCodes = [
  "paper_jam",
  "cover_open",
  "paper_out",
  "tray_missing",
  "ink_or_toner_out",
  "output_full",
  "paused",
  "stopped",
] as const;
export const printJobStatus = enumType(["queued", "printing", "done", "failed"]);

/**
 * The print outbox: `enqueuePrintJob` writes a row and opens no socket, so a printer never blocks a
 * sale or a fire (CLAUDE.md §5).
 */
export const printJobs = table(
  "print_jobs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    printerId: id("printer_id")
      .notNull()
      /* v8 ignore start */
      .references(() => printers.id),
    /* v8 ignore stop */
    // The agent holding the latest claim. For jobs without an invoice receipt claim, unpairing
    // stamps the agent whose pull ended the job.
    /* v8 ignore start */
    claimedBy: id("claimed_by").references(() => printAgents.id),
    /* v8 ignore stop */
    // Office pages are rendered on request. Thermal jobs carry their ESC/POS bytes.
    payload: binary("payload"),
    // Drawer pulses share transport delivery but are claimed once and cannot be resent.
    kind: label("kind").$type<"document" | "drawer" | "a4">().notNull().default("document"),
    // Null for other documents and drawer jobs; false for a receipt original, true for a copy.
    receiptCopy: flag("receipt_copy"),
    pageDocument: enumType(["invoice", "receipt"])("page_document"),
    // The language the receipt is printed in: an A4 receipt page's, or on a document job naming a
    // sale the language chosen at the till, where null means the sale's own `locale`.
    pageLanguage: label("page_language"),
    pageDesignation: enumType(["original", "duplicate"])("page_designation"),
    // Staff confirmation of customer handover, separate from the agent's delivered_at stamp.
    handedOverBy: id("handed_over_by").references(() => persons.id, { onDelete: "restrict" }),
    handedOverAt: tsString("handed_over_at"),
    status: printJobStatus("status").notNull().default("queued"),
    attempts: count("attempts").notNull().default(0),
    lastError: label("last_error"),
    nextAttemptAt: tsString("next_attempt_at"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    // The claim lease anchor, stamped on each claim and by the functions `claimed_by` names. A
    // `printing` document whose lease has expired, or whose `claimed_at` is NULL, is re-claimed.
    // Drawer claims are not recovered: an uncertain pulse must not repeat.
    claimedAt: tsString("claimed_at"),
    // An invoice receipt retains its hashed token so a late report can still be authenticated.
    claimTokenHash: label("claim_token_hash"),
    printerHold: enumType(printHoldCodes)("printer_hold"),
    deliveredAt: tsString("delivered_at"),
    // The job a resend copies, always the first of its chain: a resend of a resend names the same
    // job (`resendPrintJob`, packages/printing/src/outbox.ts).
    /* v8 ignore start */
    resendOf: id("resend_of").references((): AnySQLiteColumn => printJobs.id),
    /* v8 ignore stop */
    // The sale a till receipt prints, original or duplicate (`apps/server/src/receipt-print.ts`); a
    // resend copies it.
    /* v8 ignore start */
    saleId: id("sale_id").references(() => sales.id),
    /* v8 ignore stop */
    tenderRefundId: id("tender_refund_id").references(() => refunds.id),
  },
  (t) => [
    index("print_jobs_pull_idx").on(t.printerId, t.status),
    index("print_jobs_printer_kind_idx").on(t.printerId, t.kind),
    index("print_jobs_resend_of_idx").on(t.resendOf),
    index("print_jobs_sale_id_idx").on(t.saleId),
    check("print_jobs_kind_ck", sql`${t.kind} in ('document', 'drawer', 'a4')`),
    check("print_jobs_status_ck", enumCheck(t.status)),
    check("print_jobs_payload_ck", sql`(${t.kind} = 'a4') = (${t.payload} is null)`),
    check("print_jobs_a4_sale_ck", sql`${t.kind} <> 'a4' or ${t.saleId} is not null`),
    check("print_jobs_page_document_ck", enumCheck(t.pageDocument)),
    check("print_jobs_page_designation_ck", enumCheck(t.pageDesignation)),
    check(
      "print_jobs_page_ck",
      sql`(${t.kind} = 'a4') = (${t.pageDocument} is not null)
        and ((${t.pageDocument} is 'receipt') = (${t.pageLanguage} is not null)
          or (${t.kind} = 'document' and ${t.saleId} is not null))
        and (${t.pageDocument} is 'receipt') = (${t.pageDesignation} is not null)`,
    ),
    check("print_jobs_printer_hold_ck", enumCheck(t.printerHold)),
    check("print_jobs_a4_hold_ck", sql`${t.printerHold} is null or ${t.kind} = 'a4'`),
    check(
      "print_jobs_handover_pair_ck",
      sql`(${t.handedOverBy} is null) = (${t.handedOverAt} is null)`,
    ),
  ],
);
