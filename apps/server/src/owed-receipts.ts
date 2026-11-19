import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  invoiceDeliveries,
  printers,
  printJobs,
  sales,
  unpaidDepartures,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINT_JOB_MOVED,
  PRINTER_DELETED,
  PRINTER_UNPAIRED,
} from "@waitron/printing";
import { codeOf } from "@waitron/server-kit";
import { resendInvoicePrintJob } from "./invoice-print.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";

// A print that gave up, and an email that failed, still owe the ticket; a delivery that may have
// arrived (`unknown`), on any medium, does not.
export async function owesOriginal(tx: Transaction, saleId: string): Promise<boolean> {
  const [sale] = await tx
    .select({ correctsSaleId: sales.correctsSaleId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined || sale.correctsSaleId !== null) return false;
  const [departure] = await tx
    .select({ id: unpaidDepartures.id })
    .from(unpaidDepartures)
    .where(eq(unpaidDepartures.saleId, saleId))
    .limit(1);
  if (departure !== undefined) return false;
  const [print] = await tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(
      and(
        eq(printJobs.saleId, saleId),
        eq(printJobs.receiptCopy, false),
        or(
          inArray(printJobs.status, ["queued", "printing", "done"]),
          and(eq(printJobs.status, "failed"), lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
        ),
      ),
    )
    .limit(1);
  if (print !== undefined) return false;
  const [delivered] = await tx
    .select({ id: invoiceDeliveries.id })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, saleId),
        eq(invoiceDeliveries.designation, "original"),
        inArray(invoiceDeliveries.status, ["queued", "sending", "sent", "unknown"]),
      ),
    )
    .limit(1);
  return delivered === undefined;
}

const ROUND_AFTER_MS = 10 * 60_000;
const OWED_FOR_MS = 24 * 60 * 60_000;
const ROUND_EVERY_MS = 60_000;
// A job ended because its printer went away or it moved elsewhere may already have printed (an
// unpairing can end a job mid-print), so a fresh round there could print a second original.
const ENDED_NOT_FAILED = [PRINTER_DELETED, PRINTER_UNPAIRED, PRINT_JOB_MOVED];

/** Resends, as the till's Retry original does, each owed original that gave up a while ago. */
export async function startFreshRounds(
  db: Database,
  now: Date,
  log: Logger,
  signal?: AbortSignal,
): Promise<string[]> {
  const later = sql.raw("later");
  const candidates = await db
    .select({ id: printJobs.id, saleId: sales.id })
    .from(sales)
    .innerJoin(printJobs, eq(printJobs.saleId, sales.id))
    .innerJoin(printers, eq(printers.id, printJobs.printerId))
    .where(
      and(
        gte(sales.issuedAt, new Date(now.getTime() - OWED_FOR_MS).toISOString()),
        eq(printJobs.kind, "document"),
        eq(printJobs.receiptCopy, false),
        eq(printJobs.status, "failed"),
        gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS),
        or(isNull(printJobs.lastError), sql`${printJobs.lastError} not in ${ENDED_NOT_FAILED}`),
        lt(printJobs.claimedAt, new Date(now.getTime() - ROUND_AFTER_MS).toISOString()),
        // `printers_deleted_ck` makes a deleted printer inactive too.
        eq(printers.active, true),
        // Newest by insert order: print jobs are never deleted, and `created_at` follows the clock,
        // which can step back.
        sql`not exists (
          select 1 from ${printJobs} as ${later}
          where ${later}.sale_id = ${printJobs.saleId} and ${later}.kind = 'document'
            and ${later}.receipt_copy = 0 and ${later}.rowid > ${printJobs}.rowid)`,
      ),
    );
  const resent: string[] = [];
  for (const { id, saleId } of candidates) {
    if (signal?.aborted) break;
    try {
      const retry = await withTransaction(db, async (tx) =>
        (await owesOriginal(tx, saleId)) ? resendInvoicePrintJob(tx, id, null, now) : undefined,
      );
      if (retry !== undefined) resent.push(retry.jobId);
    } catch (error) {
      log("warn", "receipt.fresh_round_failed", { jobId: id, errorCode: codeOf(error) });
    }
  }
  return resent;
}

export function owedReceiptJob(deps: {
  db: Database;
  isPrimary: () => boolean;
  log: Logger;
}): JobDefinition {
  return {
    name: "receipt.owed",
    applies: deps.isPrimary,
    minSleepMs: ROUND_EVERY_MS,
    maxSleepMs: ROUND_EVERY_MS,
    backoff: { firstMs: ROUND_EVERY_MS, maxMs: ROUND_EVERY_MS },
    async pass({ now, signal }) {
      for (const jobId of await startFreshRounds(deps.db, now, deps.log, signal))
        deps.log("info", "receipt.fresh_round", { jobId });
      return { nextDueAt: null };
    },
  };
}
