import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  exists,
  isNull,
  not,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  billAdvances,
  invoiceDeliveries,
  invoiceSeries,
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
} from "@waitron/printing";
import { codeOf } from "@waitron/server-kit";
import { deviceOrigin } from "@waitron/shared";
import { resendInvoicePrintJob } from "./invoice-print.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { deviceMayPrintReceipts, enqueueOriginalReceipt, printerLookup } from "./receipt-print.js";
import type { LayOutSaleReceipt } from "./receipt-print.js";
import type { FiscalBackend } from "@waitron/fiscal";
import { queueOwedOriginal } from "./till-sale.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";

const ownOriginal = alias(printJobs, "owed_own_original");
const laterOriginal = alias(printJobs, "owed_later_original");

// A print that gave up, and an email that failed, still owe the ticket; a delivery that may have
// arrived (`unknown`), on any medium, does not. `saleId` names `sales.id` or a column equal to it,
// and the caller's query has `sales` in its FROM: the check reads its `corrects_sale_id` and
// `working_order_id`.
function stillOwed(q: Transaction, saleId: SQLiteColumn): SQL {
  return and(
    isNull(sales.correctsSaleId),
    // Found through the bill's unique key, as `unpaid_departures.sale_id` has no index; its one
    // writer, `insertDeparture`, names the bill's own sale.
    notExists(
      q
        .select({ one: sql`1` })
        .from(unpaidDepartures)
        .where(
          and(
            eq(unpaidDepartures.workingOrderId, sales.workingOrderId),
            eq(unpaidDepartures.saleId, saleId),
          ),
        ),
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

/**
 * A sale this box's installation recorded: under its node and a series still live. A restore under
 * a fiscal regime retires the old series; a promoted spare sells under its own node.
 */
function thisInstallation(nodeId: string): SQL {
  return and(
    eq(sales.nodeId, nodeId),
    sql`exists (select 1 from ${invoiceSeries} where ${invoiceSeries.id} = ${sales.seriesId} and ${invoiceSeries.retiredAt} is null)`,
  )!;
}

const ROUND_AFTER_MS = 10 * 60_000;
const OWED_FOR_MS = 24 * 60 * 60_000;
const ROUND_EVERY_MS = 60_000;
const LOOK_AGAIN_MS = 60 * 60_000;
// Delete can end a job that already reached the printer. A fresh round for a deleted or moved job
// could print a second original.
const ENDED_NOT_FAILED = [PRINTER_DELETED, PRINT_JOB_MOVED];

/** The newest original of each owed sale issued in the last day, given up on an active printer. */
export function givenUpOriginals(q: Transaction, nodeId: string, now: Date, jobId?: string) {
  return (
    q
      .select({ id: printJobs.id, claimedAt: printJobs.claimedAt })
      // A one-job read goes by the job's id. The box collects no planner statistics; unnamed, the
      // day's read took `sales_corrects_idx` on SQLite 3.54.1.
      .from(jobId === undefined ? sql`${sales} indexed by sales_issued_idx` : sales)
      .innerJoin(printJobs, eq(printJobs.saleId, sales.id))
      .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
      .where(
        and(
          gte(sales.issuedAt, new Date(now.getTime() - OWED_FOR_MS).toISOString()),
          thisInstallation(nodeId),
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
          // Newest by insert order, since `created_at` follows the clock, which can step back.
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
  layOut: LayOutSaleReceipt,
  nodeId: string,
  now: Date,
  log: Logger,
  signal?: AbortSignal,
): Promise<{ resent: string[]; nextDueAt: Date | null }> {
  const candidates = await givenUpOriginals(db, nodeId, now);
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
        const [still] = await givenUpOriginals(tx, nodeId, now, id);
        if (still === undefined || dueAt(still.claimedAt!) > now.getTime()) return undefined;
        return resendInvoicePrintJob(tx, layOut, id, null, now);
      });
      if (retry !== undefined) resent.push(retry.jobId);
    } catch (error) {
      log("warn", "receipt.fresh_round_failed", { jobId: id, errorCode: codeOf(error) });
      next = now.getTime();
    }
  }
  return { resent, nextDueAt: next === null ? null : new Date(next) };
}

const originalJob = alias(printJobs, "owed_original_job");

/** Whether the sale has an original receipt job, on any printer, in any state. */
function hasOriginalJob(q: Transaction, saleId: SQLiteColumn): SQL {
  return exists(
    q
      .select({ one: sql`1` })
      .from(originalJob)
      .where(and(eq(originalJob.saleId, saleId), eq(originalJob.receiptCopy, false))),
  );
}

/** Whether the sale is an advance's own ticket, which has no working order of its own. */
function isAdvance(q: Transaction, saleId: SQLiteColumn): SQL {
  return exists(
    q
      .select({ one: sql`1` })
      .from(billAdvances)
      .where(eq(billAdvances.advanceSaleId, saleId)),
  );
}

/**
 * This installation's sales made by a device, issued in the last day, that still owe their receipt
 * and have no original job: a bill's invoice, or an advance's own ticket. `workingOrderId` is null
 * for an advance.
 */
export function owedSales(q: Transaction, nodeId: string, now: Date, saleId?: string) {
  return (
    q
      .select({
        saleId: sql<string>`${sales.id}`,
        deviceId: sql<string>`${sales.deviceId}`,
        workingOrderId: sql<string | null>`${sales.workingOrderId}`,
        issuedAt: sql<string>`${sales.issuedAt}`,
      })
      // A one-sale read goes by its id; the day's read names its index as `givenUpOriginals` does.
      .from(saleId === undefined ? sql`${sales} indexed by sales_issued_idx` : sales)
      .where(
        and(
          gte(sales.issuedAt, new Date(now.getTime() - OWED_FOR_MS).toISOString()),
          saleId === undefined ? undefined : eq(sales.id, saleId),
          eq(sales.source, "device"),
          or(isNotNull(sales.workingOrderId), isAdvance(q, sales.id)),
          thisInstallation(nodeId),
          not(hasOriginalJob(q, sales.id)),
          stillOwed(q, sales.id),
        ),
      )
  );
}

/** Whether the device may print receipts and has a receipt printer, switched off or not. */
async function canPrintReceipts(q: Transaction, deviceId: string): Promise<boolean> {
  if (!(await deviceMayPrintReceipts(q, deviceId))) return false;
  const printers = printerLookup(q, deviceOrigin(deviceId), { whileSwitchedOff: true });
  return (await printers("receipt")) !== undefined;
}

/**
 * Queues the original of each owed till sale (a bill's invoice as the till's close request does, an
 * advance's ticket as its payment does) issued at least 10 minutes ago on its device's receipt
 * printer, and says when the next sale will be due. A device that may not print receipts, or has
 * no receipt printer, is left until one changes.
 */
export async function printOwedTickets(
  deps: { db: Database; backend: FiscalBackend; cfg: TradingContext; log: Logger },
  now: Date,
  signal?: AbortSignal,
): Promise<{ queued: string[]; nextDueAt: Date | null }> {
  const { db, backend, cfg, log } = deps;
  const candidates = await owedSales(db, cfg.nodeId, now);
  const queued: string[] = [];
  let next: number | null = null;
  const printing = new Map<string, boolean>();
  for (const { saleId, deviceId, workingOrderId, issuedAt } of candidates) {
    if (signal?.aborted) return { queued, nextDueAt: null };
    const due = Date.parse(issuedAt) + ROUND_AFTER_MS;
    if (due > now.getTime()) {
      next = Math.min(next ?? Infinity, due);
      continue;
    }
    try {
      // Resolved once per device and pass, outside the write lock: a handheld with no printer can
      // owe every sale of the day.
      if (!printing.has(deviceId)) printing.set(deviceId, await canPrintReceipts(db, deviceId));
      if (printing.get(deviceId) !== true) continue;
      // The candidate and the device's profile are read again under the write lock: either may have
      // changed while this pass waited for it.
      const made = await withTransaction(db, async (tx) => {
        if (signal?.aborted) return false;
        const [still] = await owedSales(tx, cfg.nodeId, now, saleId);
        if (still === undefined || !(await deviceMayPrintReceipts(tx, deviceId))) return false;
        const origin = { ...cfg, origin: deviceOrigin(deviceId) };
        if (workingOrderId === null) return queueOwedAdvance(tx, backend, origin, saleId);
        return queueOwedOriginal(tx, backend, origin, workingOrderId, null);
      });
      if (made) queued.push(saleId);
    } catch (error) {
      log("warn", "receipt.owed_ticket_failed", { saleId, errorCode: codeOf(error) });
      next = now.getTime();
    }
  }
  return { queued, nextDueAt: next === null ? null : new Date(next) };
}

/** Queues advance `saleId`'s original, built as `issueAdvance` builds it. The caller has read the
 * sale as owed in this transaction. */
async function queueOwedAdvance(
  tx: Transaction,
  backend: FiscalBackend,
  cfg: OriginConfig,
  saleId: string,
): Promise<boolean> {
  const ticket = await readTransactionReceipt(backend, tx, cfg, saleId);
  const made = await enqueueOriginalReceipt(tx, cfg, ticket, saleId, {
    personId: null,
    printers: printerLookup(tx, cfg.origin, { whileSwitchedOff: true }),
  });
  return typeof made === "object";
}

const earlier = (a: Date | null, b: Date | null) => (a === null ? b : b === null || a <= b ? a : b);

export function owedReceiptJob(deps: {
  db: Database;
  layOutSaleReceipt: LayOutSaleReceipt;
  backend: FiscalBackend;
  cfg: TradingContext;
  isPrimary: () => boolean;
  log: Logger;
}): JobDefinition {
  return {
    name: "receipt.owed",
    applies: deps.isPrimary,
    // A print giving up, a printer switched on and a failed email can each make a receipt owed; a
    // sale, a device given a printer and a profile allowed to print can each make one printable.
    wakeOn: ["print_jobs", "printers", "invoice_deliveries", "sales", "devices", "device_profiles"],
    minSleepMs: ROUND_EVERY_MS,
    maxSleepMs: LOOK_AGAIN_MS,
    backoff: { firstMs: ROUND_EVERY_MS, maxMs: ROUND_EVERY_MS },
    async pass({ now, signal }) {
      const { resent, nextDueAt } = await startFreshRounds(
        deps.db,
        deps.layOutSaleReceipt,
        deps.cfg.nodeId,
        now,
        deps.log,
        signal,
      );
      for (const jobId of resent) deps.log("info", "receipt.fresh_round", { jobId });
      const owed = await printOwedTickets(deps, now, signal);
      for (const saleId of owed.queued) deps.log("info", "receipt.owed_ticket", { saleId });
      return { nextDueAt: earlier(nextDueAt, owed.nextDueAt) };
    },
  };
}
