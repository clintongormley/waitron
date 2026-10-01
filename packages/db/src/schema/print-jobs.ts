import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  binary,
  count,
  enumCheck,
  enumType,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { printAgents } from "./print-agents.js";
import { printers } from "./printers.js";
import { sales } from "./sales.js";
import { locations } from "./tenants.js";

/**
 * `queued` → `printing` on an agent's claim → `done`, or `failed`, which is re-claimed until the
 * attempt cap (`packages/printing/src/runtime.ts`). `failUnprintableBluetoothJobs` and
 * `endUnpairedPrinterJobs` set a job to `failed` at the cap, without a claim.
 */
export const printJobStatus = enumType(["queued", "printing", "done", "failed"]);

/**
 * The print outbox: `enqueuePrintJob` writes a row and opens no socket, so a printer never blocks a
 * sale or a fire (CLAUDE.md §5).
 */
export const printJobs = table(
  "print_jobs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    printerId: id("printer_id")
      .notNull()
      /* v8 ignore start */
      .references(() => printers.id),
    /* v8 ignore stop */
    // The agent holding the latest claim, which alone may report the job, or the agent whose pull
    // ended it through `failUnprintableBluetoothJobs` or `endUnpairedPrinterJobs` (runtime.ts).
    /* v8 ignore start */
    claimedBy: id("claimed_by").references(() => printAgents.id),
    /* v8 ignore stop */
    // Opaque ESC/POS bytes. A read through this column yields a `Uint8Array`; `claimPrintJobs`
    // (packages/printing/src/runtime.ts) reads it with raw SQL and gets the driver's value instead.
    payload: binary("payload").notNull(),
    // Drawer pulses share transport delivery but cannot be repeated through document resend.
    kind: label("kind").$type<"document" | "drawer">().notNull().default("document"),
    status: printJobStatus("status").notNull().default("queued"),
    attempts: count("attempts").notNull().default(0),
    lastError: label("last_error"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    // The claim lease anchor, stamped on each claim and by the functions `claimed_by` names. A
    // `printing` row whose lease has expired, or whose `claimed_at` is NULL, is re-claimed, so
    // delivery is at-least-once: a reclaim may reprint.
    claimedAt: tsString("claimed_at"),
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
  },
  (t) => [
    index("print_jobs_pull_idx").on(t.printerId, t.status),
    index("print_jobs_resend_of_idx").on(t.resendOf),
    index("print_jobs_sale_id_idx").on(t.saleId),
    check("print_jobs_kind_ck", sql`${t.kind} in ('document', 'drawer')`),
    check("print_jobs_status_ck", enumCheck(t.status)),
  ],
);
