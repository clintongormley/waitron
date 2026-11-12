import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import {
  printers,
  printJobs,
  receiptReprints,
  sales,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { readJsonBody, requireBodyUuid } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { assertDeviceCapability } from "./device-session.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import type { Logger } from "./logger.js";
import { expireInvoiceDeliveryClaims } from "./invoice-delivery.js";
import { requestPrintDelivery, switchToReceipt } from "./invoice-delivery-actions.js";
import { readInvoiceDeliveryState } from "./invoice-delivery-status.js";
import { resendInvoicePrintJob } from "./invoice-print.js";
import {
  confirmReceiptHandover,
  enqueueReceiptCopy,
  resolveInvoicePrinter,
  resolveReceiptPrinter,
} from "./receipt-print.js";
import { requestCfg } from "./request-config.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";
function parsedId(value: string): string {
  if (!isUuid(value)) throw new AppError("sale.not_found", { saleId: value });
  return value.toLowerCase();
}
export function mountTransactionReceiptApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
): void {
  async function orderlessSale(
    tx: Transaction,
    session: Parameters<typeof checkZones>[1],
    id: string,
  ) {
    const scope = await resolveTransactionScope(tx, id);
    const [sale] = await tx
      .select({ id: sales.id, workingOrderId: sales.workingOrderId })
      .from(sales)
      .where(eq(sales.id, id));
    if (sale === undefined || sale.workingOrderId !== null)
      throw new AppError("sale.not_found", { saleId: id });
    await checkZones(
      tx,
      session,
      scope.workingOrderIds.map((orderId) => ({ orderId })),
    );
    return sale;
  }

  async function invoiceState(
    tx: Transaction,
    session: Parameters<typeof checkZones>[1] & { deviceId: string },
    id: string,
  ) {
    await orderlessSale(tx, session, id);
    await expireInvoiceDeliveryClaims(tx);
    const state = await readInvoiceDeliveryState(tx, id, {
      emailAvailable: false,
      printers: async () => {
        const printer = await resolveInvoicePrinter(tx, requestCfg(deps.cfg, session).origin);
        return printer === undefined ? [] : [printer];
      },
    });
    if (state === null) throw new AppError("invoice_delivery.full_invoice_required", {});
    return state;
  }

  app.get("/api/transactions/:saleId/receipt-print", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = parsedId(c.req.param("saleId"));
      const status = await withTransaction(deps.db, async (tx) => {
        const state = await invoiceState(tx, session, id);
        if (state.receipt.status === "not_queued") return state.receipt;
        const [printer] = await tx
          .select({ id: printers.id, name: printers.name })
          .from(printJobs)
          .innerJoin(printers, eq(printers.id, printJobs.printerId))
          .where(eq(printJobs.id, state.receipt.jobId));
        return {
          ...state.receipt,
          printerId: printer!.id,
          printerName: printer!.name,
          ...(state.receipt.canRetry && state.receiptPrinterWithdrawn
            ? { printerWithdrawn: true }
            : {}),
        };
      });
      return c.json(status);
    }),
  );
  app.post("/api/transactions/:saleId/receipt-print/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt_retry", session.device);
      await assertRequestDevice(deps, c, session);
      const id = parsedId(c.req.param("saleId"));
      const result = await withTransaction(deps.db, async (tx) => {
        const state = await invoiceState(tx, session, id);
        if (state.receipt.status === "not_queued")
          throw new AppError("print_job.not_found", { id });
        if (!state.receipt.canRetry)
          throw new AppError("print_job.not_resendable", { id: state.receipt.jobId });
        if (state.receiptPrinterWithdrawn)
          throw new AppError("invoice_delivery.printer_invalid", {});
        return resendInvoicePrintJob(tx, state.receipt.jobId, session.personId);
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/receipt-print/handover", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const id = parsedId(c.req.param("saleId"));
      const status = await withTransaction(deps.db, async (tx) => {
        await invoiceState(tx, session, id);
        return confirmReceiptHandover(tx, id, session.personId);
      });
      return c.json(status);
    }),
  );

  app.get("/api/transactions/:saleId/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = parsedId(c.req.param("saleId"));
      const status = await withTransaction(deps.db, async (tx) => {
        const state = await invoiceState(tx, session, id);
        return state.status;
      });
      return c.json(status);
    }),
  );
  app.post("/api/transactions/:saleId/deliveries/:deliveryId/to-receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(
        deps,
        c,
        "print-receipt",
        "invoice_delivery_to_receipt",
        session.device,
      );
      await assertRequestDevice(deps, c, session);
      const id = parsedId(c.req.param("saleId"));
      const body = await readJsonBody<{ requestKey?: unknown }>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const cfg = requestCfg(deps.cfg, session);
      const result = await withTransaction(deps.db, async (tx) =>
        switchToReceipt(
          tx,
          { backend: deps.backend, cfg },
          await orderlessSale(tx, session, id),
          async () => {
            const printer = await resolveInvoicePrinter(tx, cfg.origin);
            return printer === undefined ? [] : [printer];
          },
          c.req.param("deliveryId"),
          { requestKey, personId: session.personId },
        ),
      );
      return c.json(result);
    }),
  );
  app.get("/api/transactions/:saleId/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c),
        id = parsedId(c.req.param("saleId"));
      const result = await withTransaction(deps.db, async (tx) => {
        const scope = await resolveTransactionScope(tx, id);
        await checkZones(
          tx,
          session,
          scope.workingOrderIds.map((orderId) => ({ orderId })),
        );
        return readTransactionReceipt(deps.backend, tx, deps.cfg, id);
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "invoice_delivery", session.device);
      await assertRequestDevice(deps, c, session);
      const id = parsedId(c.req.param("saleId"));
      const body = await readJsonBody<{
        medium?: unknown;
        requestKey?: unknown;
        printerId?: unknown;
      }>(c);
      if (body.medium !== "print")
        throw new AppError("management.request_invalid", { field: "medium" });
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const printerId = requireBodyUuid(body.printerId, "printerId");
      const cfg = requestCfg(deps.cfg, session);
      const attempt = await withTransaction(deps.db, async (tx) => {
        const sale = await orderlessSale(tx, session, id);
        return requestPrintDelivery(
          tx,
          {
            backend: deps.backend,
            cfg,
            onReceiptCopy: async (copy) => {
              await tx.insert(receiptReprints).values({ ...copy, personId: session.personId });
            },
          },
          sale,
          async () => {
            const printer = await resolveInvoicePrinter(tx, cfg.origin);
            return printer === undefined ? [] : [printer];
          },
          { requestKey, printerId, personId: session.personId },
        );
      });
      return c.json(attempt);
    }),
  );
  app.post("/api/transactions/:saleId/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      await assertRequestDevice(deps, c, session);
      const id = parsedId(c.req.param("saleId"));
      const { language } = await readJsonBody<{ language?: unknown }>(c);
      if (language !== undefined && typeof language !== "string")
        throw new AppError("management.request_invalid", { field: "language" });
      const cfg = requestCfg(deps.cfg, session);
      await withTransaction(deps.db, async (tx) => {
        const scope = await resolveTransactionScope(tx, id);
        await checkZones(
          tx,
          session,
          scope.workingOrderIds.map((orderId) => ({ orderId })),
        );
        const ticket = await readTransactionReceipt(deps.backend, tx, cfg, id);
        if (
          language !== undefined &&
          language !== ticket.locale &&
          !(await readOfferedReceiptLanguages(tx)).includes(language)
        )
          throw new AppError("management.request_invalid", { field: "language" });
        const printer = await resolveReceiptPrinter(tx, cfg.origin);
        if (printer === undefined) return;
        const copy = await enqueueReceiptCopy(
          tx,
          cfg,
          ticket,
          id,
          printer,
          language,
          session.personId,
        );
        if (copy !== undefined)
          await tx
            .insert(receiptReprints)
            .values({ saleId: id, printJobId: copy.jobId, personId: session.personId });
      });
      return c.body(null, 200);
    }),
  );
}
