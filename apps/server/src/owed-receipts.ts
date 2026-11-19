import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  invoiceDeliveries,
  isReceiptPrinter,
  printers,
  printJobs,
  sales,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  MAX_DELIVERY_ATTEMPTS,
  originalPrintDoneOrTrying,
  PRINT_JOB_MOVED,
  PRINTER_DELETED,
  PRINTER_UNPAIRED,
} from "@waitron/printing";
import { codeOf } from "@waitron/server-kit";
import { resendInvoicePrintJob } from "./invoice-print.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";

const ownOriginal = alias(printJobs, "owed_own_original");
const laterOriginal = alias(printJobs, "owed_later_original");

// A print that gave up, and an email that failed, still owe the ticket; a delivery that may have
// arrived (`unknown`), on any medium, does not. `saleId` names `sales.id` or a column equal to it,
// and the caller's query has `sales` in its FROM: the check reads its `corrects_sale_id`.
function stillOwed(q: Transaction, saleId: SQLiteColumn): SQL {
  return and(
    isNull(sales.correctsSaleId),
    notExists(
      q
        .select({ one: sql`1` })
        .from(unpaidDepartures)
        .where(eq(unpaidDepartures.saleId, saleId)),
    ),
    notExists(
      q
        .select({ one: sql`1` })
        .from(ownOriginal)
        .where(originalPrintDoneOrTrying(saleId, ownOriginal)),
    ),
    notExists(
      q
        .select({ one: sql`1` })
        .from(invoiceDeliveries)
        .where(
          and(
            eq(invoiceDeliveries.saleId, saleId),
            eq(invoiceDeliveries.designation, "original"),
            inArray(invoiceDeliveries.status, ["queued", "sending", "sent", "unknown"]),
          ),
        ),
    ),
  )!;
}

export async function owesOriginal(tx: Transaction, saleId: string): Promise<boolean> {
  const [owed] = await tx
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.id, saleId), stillOwed(tx, sales.id)));
  return owed !== undefined;
}

const ROUND_AFTER_MS = 10 * 60_000;
const OWED_FOR_MS = 24 * 60 * 60_000;
const ROUND_EVERY_MS = 60_000;
const LOOK_AGAIN_MS = 60 * 60_000;
// A job ended because its printer went away or it moved elsewhere may already have printed (an
// unpairing can end a job mid-print), so a fresh round there could print a second original.
const ENDED_NOT_FAILED = [PRINTER_DELETED, PRINTER_UNPAIRED, PRINT_JOB_MOVED];

/** The newest original of each owed sale issued in the last day, given up on an active printer. */
export function givenUpOriginals(q: Transaction, now: Date, jobId?: string) {
  return (
    q
      .select({ id: printJobs.id, claimedAt: printJobs.claimedAt })
      // The box collects no planner statistics; unnamed, SQLite 3.54.1 took `sales_corrects_idx`.
      .from(sql`${sales} indexed by sales_issued_idx`)
      .innerJoin(printJobs, eq(printJobs.saleId, sales.id))
      .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
      .where(
        and(
          gte(sales.issuedAt, new Date(now.getTime() - OWED_FOR_MS).toISOString()),
          // Keyed on `sales.id`, `unpaid_departures` was scanned once per sale of the day.
          stillOwed(q, printJobs.saleId),
          jobId === undefined ? undefined : eq(printJobs.id, jobId),
          eq(printJobs.kind, "document"),
          eq(printJobs.receiptCopy, false),
          eq(printJobs.status, "failed"),
          gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS),
          or(isNull(printJobs.lastError), notInArray(printJobs.lastError, ENDED_NOT_FAILED)),
          isNotNull(printJobs.claimedAt),
          // `printers_deleted_ck` makes a deleted printer inactive too.
          eq(printers.active, true),
          // Newest by insert order: print jobs are never deleted, and `created_at` follows the clock,
          // which can step back.
          notExists(
            q
              .select({ one: sql`1` })
              .from(laterOriginal)
              .where(
                and(
                  eq(laterOriginal.saleId, printJobs.saleId),
                  eq(laterOriginal.kind, "document"),
                  eq(laterOriginal.receiptCopy, false),
                  sql`${laterOriginal}.rowid > ${printJobs}.rowid`,
                ),
              ),
          ),
        ),
      )
  );
}

const dueAt = (claimedAt: string) => Date.parse(claimedAt) + ROUND_AFTER_MS;

/**
 * Resends, as the till's Retry original does, each owed original that gave up a while ago, and says
 * when the next one that has not waited long enough will be due.
 */
export async function startFreshRounds(
  db: Database,
  now: Date,
  log: Logger,
  signal?: AbortSignal,
): Promise<{ resent: string[]; nextDueAt: Date | null }> {
  const candidates = await givenUpOriginals(db, now);
  const resent: string[] = [];
  let next: number | null = null;
  for (const { id, claimedAt } of candidates) {
    if (signal?.aborted) return { resent, nextDueAt: null };
    if (dueAt(claimedAt!) > now.getTime()) {
      next = Math.min(next ?? Infinity, dueAt(claimedAt!));
      continue;
    }
    try {
      // The candidate and the stop are read again under the write lock: either may have changed
      // while this round waited for it.
      const retry = await withTransaction(db, async (tx) => {
        if (signal?.aborted) return undefined;
        const [still] = await givenUpOriginals(tx, now, id);
        if (still === undefined || dueAt(still.claimedAt!) > now.getTime()) return undefined;
        return resendInvoicePrintJob(tx, id, null, now);
      });
      if (retry !== undefined) resent.push(retry.jobId);
    } catch (error) {
      log("warn", "receipt.fresh_round_failed", { jobId: id, errorCode: codeOf(error) });
      next = now.getTime();
    }
  }
  return { resent, nextDueAt: next === null ? null : new Date(next) };
}

export function owedReceiptJob(deps: {
  db: Database;
  isPrimary: () => boolean;
  log: Logger;
}): JobDefinition {
  return {
    name: "receipt.owed",
    applies: deps.isPrimary,
    // A print giving up, a printer switched on and a failed email can each make a receipt owed.
    wakeOn: ["print_jobs", "printers", "invoice_deliveries"],
    minSleepMs: ROUND_EVERY_MS,
    maxSleepMs: LOOK_AGAIN_MS,
    backoff: { firstMs: ROUND_EVERY_MS, maxMs: ROUND_EVERY_MS },
    async pass({ now, signal }) {
      const { resent, nextDueAt } = await startFreshRounds(deps.db, now, deps.log, signal);
      for (const jobId of resent) deps.log("info", "receipt.fresh_round", { jobId });
      return { nextDueAt };
    },
  };
}
