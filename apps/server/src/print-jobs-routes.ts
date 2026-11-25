import "./errors.js";
import {
  printJobs,
  printers,
  invoiceDeliveries,
  isA4Printer,
  isReceiptPrinter,
  receiptRollColumns,
} from "@waitron/db";
import {
  MAX_DELIVERY_ATTEMPTS,
  textGrid,
  jobWidthDots,
  canResendPrintJob,
} from "@waitron/printing";
import {
  type Logger,
  requireManagementSession,
  requireUuidParam,
  readJsonBody,
  requireBodyUuid,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { eq, sql, desc, and, or, ne, gte, lt, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { readSendingPagePrinters, pagePrinterHold } from "./invoice-delivery-status.js";
import { assertPrintPayload } from "./invoice-print.js";
import type { PageTestPages } from "./page-test-pages.js";
import type { PrintApiDeps, PrintPermissionGate } from "./print-api-deps.js";
import { run } from "./print-api-errors.js";
import { activeA4QueuePrinters, readA4QueueInvoice, previewA4Invoice } from "./print-job-a4.js";
import { previewPrintJob } from "./print-job-preview.js";
import {
  linkedKitchenPrintoutSql,
  type ReprintRule,
  reprintRule,
  type PrinterSeen,
  isStuckJob,
  isWaiting,
  isCompletedReceiptOriginal,
  reprintJobOn,
} from "./print-job-reprint.js";
import { RECEIPT_OUT_OF_DATE } from "./receipt-print.js";

export const RECENT_JOBS_LIMIT = 100;

export function mountPrintJobsRoutes(
  app: Hono,
  deps: PrintApiDeps,
  gated: PrintPermissionGate,
  visibleNow: (now?: number) => Set<string>,
  seen: (printer: { transport: string; localKey: string | null }, visible?: Set<string>) => boolean,
  testPages: PageTestPages,
  log: Logger,
): void {
  // Unfinished jobs remain visible while staff browse delivered jobs.
  app.get("/management-api/print-jobs", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await gated(sessionId, async (tx) => {
        const completedPage = c.req.query("completedPage") ?? "0";
        const offset = Number(completedPage) * RECENT_JOBS_LIMIT;
        if (!/^\d+$/.test(completedPage) || !Number.isSafeInteger(offset))
          throw new AppError("management.request_invalid", { field: "completedPage" });
        const recentCompleted = tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(eq(printJobs.status, "done"))
          .orderBy(sql`${printJobs.deliveredAt} desc nulls last`, desc(printJobs.id))
          .limit(RECENT_JOBS_LIMIT)
          .offset(offset);
        const recentFailed = tx
          .select({ id: printJobs.id })
          .from(printJobs)
          .where(
            and(
              eq(printJobs.status, "failed"),
              or(ne(printJobs.kind, "document"), gte(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
            ),
          )
          .orderBy(desc(printJobs.createdAt), desc(printJobs.id))
          .limit(RECENT_JOBS_LIMIT);
        const jobs = await tx
          .select({
            id: printJobs.id,
            printerId: printJobs.printerId,
            printerName: printers.name,
            printerDeletedAt: printers.deletedAt,
            printerActive: printers.active,
            printerTransport: printers.transport,
            printerLocalKey: printers.localKey,
            status: printJobs.status,
            kind: printJobs.kind,
            pageDocument: printJobs.pageDocument,
            printerHold: printJobs.printerHold,
            deliveryStatus: invoiceDeliveries.status,
            deliveryMedium: invoiceDeliveries.medium,
            receiptCopy: printJobs.receiptCopy,
            saleId: printJobs.saleId,
            attempts: printJobs.attempts,
            lastError: printJobs.lastError,
            createdAt: printJobs.createdAt,
            deliveredAt: printJobs.deliveredAt,
            // `jobWidthDots` reads a printout's width from its first ten bytes alone.
            head: sql<Uint8Array | null>`substr(${printJobs.payload}, 1, 10)`,
            // Correlated to the outer `print_jobs`; the join below keeps both sides qualified.
            linked: sql<number>`case when ${printJobs.saleId} is null then
              (${printJobs.tenderRefundId} is not null or
                ${linkedKitchenPrintoutSql(sql`coalesce(${printJobs.resendOf}, ${printJobs.id})`)})
              else 0 end`,
          })
          .from(printJobs)
          .innerJoin(
            printers,
            and(
              eq(printers.id, printJobs.printerId),
              or(
                and(isA4Printer(), eq(printJobs.kind, "a4")),
                and(isReceiptPrinter(), ne(printJobs.kind, "a4")),
              ),
            ),
          )
          .leftJoin(invoiceDeliveries, eq(invoiceDeliveries.printJobId, printJobs.id))
          .where(
            or(
              and(ne(printJobs.status, "done"), ne(printJobs.status, "failed")),
              and(
                eq(printJobs.kind, "document"),
                eq(printJobs.status, "failed"),
                lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS),
              ),
              inArray(printJobs.id, recentCompleted),
              inArray(printJobs.id, recentFailed),
            ),
          )
          .orderBy(desc(printJobs.createdAt), desc(printJobs.id));
        const reserved = await tx
          .select({ id: printJobs.id, saleId: printJobs.saleId })
          .from(printJobs)
          .where(
            and(
              inArray(
                printJobs.saleId,
                jobs.flatMap((job) =>
                  job.receiptCopy === false && job.saleId !== null ? [job.saleId] : [],
                ),
              ),
              eq(printJobs.receiptCopy, false),
              or(
                eq(printJobs.status, "done"),
                eq(printJobs.status, "queued"),
                eq(printJobs.status, "printing"),
                and(eq(printJobs.status, "failed"), lt(printJobs.attempts, MAX_DELIVERY_ATTEMPTS)),
              ),
            ),
          );
        const reservedJobs = new Map<string | null, Set<string>>();
        for (const { id, saleId } of reserved) {
          const ids = reservedJobs.get(saleId) ?? new Set<string>();
          reservedJobs.set(saleId, ids.add(id));
        }
        const reservedByAnother = (job: { id: string; saleId: string | null }): boolean => {
          const ids = reservedJobs.get(job.saleId);
          return ids !== undefined && (ids.size > 1 || !ids.has(job.id));
        };
        const targets = (
          await tx
            .select({
              id: printers.id,
              ...receiptRollColumns,
            })
            .from(printers)
            .where(and(isReceiptPrinter(), eq(printers.active, true)))
        ).map((printer) => ({
          id: printer.id,
          dots: textGrid(printer.paperWidth, printer.resolution).widthDots,
        }));
        const a4Targets = jobs.some((job) => job.deliveryMedium === "a4" && job.status === "done")
          ? [...targets.map(({ id }) => id), ...(await activeA4QueuePrinters(tx))]
          : [];
        const reprint = (job: {
          printerId: string;
          saleId: string | null;
          head: Uint8Array | null;
          linked: number;
        }): { reprintRule: ReprintRule; reprintPrinterIds: string[] } => {
          const { rule, fits } = reprintRule(
            job.saleId,
            job.linked && job.head !== null ? jobWidthDots(job.head) : null,
          );
          return {
            reprintRule: rule,
            reprintPrinterIds: targets
              .filter((printer) => printer.id !== job.printerId && fits(printer.dots))
              .map((printer) => printer.id),
          };
        };
        const visible = visibleNow();
        const seenNow: PrinterSeen = (printer) => seen(printer, visible);
        const sendingHolds = jobs.some((job) => job.kind === "a4" && job.status === "queued")
          ? new Map((await readSendingPagePrinters(tx)).map((row) => [row.printerId, row.hold]))
          : new Map();
        return jobs.map(
          ({
            kind,
            pageDocument,
            printerHold,
            deliveryStatus,
            deliveryMedium,
            printerDeletedAt,
            printerActive,
            printerTransport,
            printerLocalKey,
            receiptCopy,
            saleId,
            head,
            linked,
            ...job
          }) => {
            if (kind === "a4") {
              const canResend =
                pageDocument === "invoice" &&
                deliveryMedium === "a4" &&
                deliveryStatus === "sent" &&
                job.status === "done" &&
                printerActive;
              return {
                ...job,
                kind,
                pageDocument,
                status: deliveryStatus === "unknown" ? ("unknown" as const) : job.status,
                printerHold:
                  job.status === "queued"
                    ? pagePrinterHold(job.printerId, sendingHolds, testPages)
                    : job.status === "printing"
                      ? printerHold
                      : null,
                reprintRule: canResend ? ("any" as const) : ("own" as const),
                reprintPrinterIds: canResend ? a4Targets.filter((id) => id !== job.printerId) : [],
                stuck: false,
                canResend,
              };
            }
            const where = reprint({ printerId: job.printerId, saleId, head, linked });
            const printer = {
              active: printerActive,
              deletedAt: printerDeletedAt,
              transport: printerTransport,
              localKey: printerLocalKey,
            };
            const unseen = printer.active && !seenNow(printer);
            const stuck = isStuckJob({ ...job, kind }, printer, seenNow);
            return {
              ...job,
              ...where,
              ...(unseen && (isWaiting({ ...job, kind }) || job.status === "printing")
                ? { waitReason: "printer.not_visible" as const }
                : {}),
              stuck,
              canResend:
                printerDeletedAt === null &&
                (isCompletedReceiptOriginal({ ...job, kind, receiptCopy, saleId }) ||
                  (!(receiptCopy === false && reservedByAnother({ id: job.id, saleId })) &&
                    (canResendPrintJob({ ...job, kind, receiptCopy }) ||
                      (stuck && where.reprintPrinterIds.length > 0)))),
            };
          },
        );
      });
      return c.json(rows);
    }),
  );

  app.post("/management-api/print-jobs/:id/resend", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintJobId");
      const body = await readJsonBody<{ printerId?: unknown }>(c);
      const printerId =
        body.printerId === undefined ? undefined : requireBodyUuid(body.printerId, "printerId");
      const result = await gated(
        sessionId,
        (tx, personId) =>
          reprintJobOn(tx, deps.layOutSaleReceipt, id, printerId, personId, deps.now?.(), { seen }),
        "hardware.manage",
      );
      return c.json(result, 202);
    }),
  );

  app.get("/management-api/print-jobs/:id/preview", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireUuidParam(c.req.param("id"), "PrintJobId");
      const read = await gated(sessionId, async (tx) => {
        const [job] = await tx
          .select({
            id: printJobs.id,
            kind: printJobs.kind,
            saleId: printJobs.saleId,
            receiptCopy: printJobs.receiptCopy,
            pageLanguage: printJobs.pageLanguage,
            lastError: printJobs.lastError,
            payload: printJobs.payload,
            ...receiptRollColumns,
          })
          .from(printJobs)
          .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
          .where(eq(printJobs.id, id));
        if (job === undefined) {
          const invoice = await readA4QueueInvoice(tx, id);
          if (invoice === undefined) throw new AppError("print_job.not_found", { id });
          const document = await deps.readInvoiceDocument(tx, invoice.saleId);
          return {
            kind: "a4" as const,
            document: { ...document, duplicate: invoice.designation === "duplicate" },
          };
        }
        assertPrintPayload(job);
        // Only a sale's original gives up as out of date; its saved bytes never print, and a
        // resend lays it out again, so that is what it shows.
        return {
          kind: "receipt" as const,
          job,
          payload:
            job.lastError === RECEIPT_OUT_OF_DATE
              ? await deps.layOutSaleReceipt(
                  tx,
                  job.saleId!,
                  job.receiptCopy!,
                  job,
                  job.pageLanguage,
                )
              : job.payload!,
        };
      });
      if (read.kind === "a4")
        return c.json(await previewA4Invoice(read.document), 200, { "Cache-Control": "no-store" });
      const { job, payload } = read;
      // The printer's setting now sizes only a job that draws no line of text.
      return c.json(
        previewPrintJob(payload, {
          widthDots: textGrid(job.paperWidth, job.resolution).widthDots,
        }),
      );
    }),
  );
}
