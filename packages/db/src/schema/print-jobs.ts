import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
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
import { locations } from "./tenants.js";

/**
 * `queued` → `printing` on an agent's claim → `done`, or `failed`, which is re-claimed until the
 * attempt cap (`packages/printing/src/runtime.ts`).
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
    // The agent holding the latest claim; only it may report the job (runtime.ts).
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
    // The claim lease anchor, stamped on each claim. A `printing` row whose lease has expired, or
    // whose `claimed_at` is NULL, is re-claimed, so delivery is at-least-once: a reclaim may reprint.
    claimedAt: tsString("claimed_at"),
    deliveredAt: tsString("delivered_at"),
  },
  (t) => [
    index("print_jobs_pull_idx").on(t.printerId, t.status),
    check("print_jobs_kind_ck", sql`${t.kind} in ('document', 'drawer')`),
    check("print_jobs_status_ck", enumCheck(t.status)),
  ],
);
