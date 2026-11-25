import { type Transaction, sales, withTransaction } from "@waitron/db";
import { profileAllows } from "@waitron/layouts";
import { codeOf, readJsonBody, requireBodyUuid } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { assertDeviceCapability } from "./device-session.js";
import {
  requestPrintDelivery,
  requestEmailDelivery,
  switchToReceipt,
  retryEmailDelivery,
} from "./invoice-delivery-actions.js";
import {
  readInvoiceDeliveryState,
  type OfferedPrinter,
  readReceiptEmailDeliveries,
  readInvoiceDeliveries,
} from "./invoice-delivery-status.js";
import { expireInvoiceDeliveryClaims, invoiceDeliveryClaimsDue } from "./invoice-delivery.js";
import { canEmailInvoice } from "./invoice-email-contact.js";
import { resendInvoicePrintJob } from "./invoice-print.js";
import { printReceivedPaymentSlip } from "./payment-slip-print.js";
import {
  confirmReceiptHandover,
  saleReceiptLayout,
  type OriginalReceiptPrint,
  readOriginalReceiptPrint,
  resolveInvoicePrinter,
} from "./receipt-print.js";
import { requestCfg } from "./request-config.js";
import { requireUuidId, requireRecipient } from "./till-request-fields.js";
import { run, runBodyIds } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import { tillReceiptPreview } from "./till-receipt-preview.js";
import { readSettledTicket, printSaleReceipt, reprintSale } from "./till-sale.js";
import { requireSession, assertRequestDevice } from "./till-session.js";
import { checkZones, gateZones } from "./zone-access.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export function mountTillSaleReceiptRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  readEmailTransport: (tx: Transaction) => Promise<boolean>,
): void {
  app.get("/api/sales/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const ticket = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const ticket = await readSettledTicket(deps.backend, tx, cfg, id);
        if (c.req.query("receiptPreview") !== "1") return ticket;
        return tillReceiptPreview(tx, sale.id, ticket, cfg.practiceMode === true);
      });
      return c.json(ticket);
    }),
  );

  app.get("/api/sales/:id/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id, recipient: sales.counterpartyTaxId })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const { receipt, withdrawn } = await tillReceiptOriginal(tx, session, sale);
        // Named only where it is the reason the retry route refuses.
        return withdrawn && receipt.status !== "not_queued" && receipt.canRetry
          ? { ...receipt, printerWithdrawn: true }
          : receipt;
      });
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/receipt/handover", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return confirmReceiptHandover(tx, sale.id, session.personId);
      });
      return c.json(status);
    }),
  );

  app.post("/api/working-orders/:id/payment-slip", (c) =>
    runBodyIds("bill.payment_not_found")(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "payment_slip", session.device);
      await assertRequestDevice(deps, c, session);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<{ paymentId?: unknown }>(c);
      const paymentId = requireBodyUuid(body.paymentId, "paymentId").toLowerCase();
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId }]);
        await printReceivedPaymentSlip(tx, requestCfg(deps.cfg, session), orderId, paymentId);
      });
      return c.json({});
    }),
  );

  app.post("/api/sales/:id/receipt/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt_retry", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id, recipient: sales.counterpartyTaxId })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        await expireInvoiceDeliveryClaims(tx);
        const { receipt: original, withdrawn } = await tillReceiptOriginal(tx, session, sale);
        if (original.status === "not_queued") throw new AppError("print_job.not_found", { id });
        if (!original.canRetry)
          throw new AppError("print_job.not_resendable", { id: original.jobId });
        if (withdrawn) throw new AppError("invoice_delivery.printer_invalid", {});
        return resendInvoicePrintJob(
          tx,
          saleReceiptLayout(deps.backend, deps.cfg),
          original.jobId,
          session.personId,
        );
      });
      return c.json(result);
    }),
  );

  /**
   * The sale's receipt original, read once; for a full invoice, also whether a print request sent
   * it to a printer that is not this till's invoice printer (`receiptPrinterWithdrawn`).
   */
  async function tillReceiptOriginal(
    tx: Transaction,
    session: { deviceId: string },
    sale: { id: string; recipient: string | null },
  ): Promise<{ receipt: OriginalReceiptPrint; withdrawn: boolean }> {
    if (sale.recipient === null) {
      return { receipt: await readOriginalReceiptPrint(tx, sale.id), withdrawn: false };
    }
    const state = (await readInvoiceDeliveryState(tx, sale.id, {
      emailAvailable: false,
      printers: () => tillInvoicePrinters(tx, session),
    }))!;
    return { receipt: state.receipt, withdrawn: state.receiptPrinterWithdrawn };
  }

  /** The sale filed for working order `id`, once its zone is checked. */
  async function zonedSale(
    tx: Transaction,
    session: Parameters<typeof checkZones>[1],
    id: string,
  ): Promise<string> {
    await checkZones(tx, session, [{ orderId: id }]);
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, id));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
    return sale.id;
  }

  /** The one printer the till may print a full invoice on: its own invoice printer. */
  async function tillInvoicePrinters(
    tx: Transaction,
    session: { deviceId: string },
  ): Promise<OfferedPrinter[]> {
    const printer = await resolveInvoicePrinter(tx, requestCfg(deps.cfg, session).origin);
    return printer === undefined ? [] : [printer];
  }

  app.get("/api/sales/:id/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const receiptEmail = c.req.query("medium") === "email";
      const canDeliverInvoice =
        !receiptEmail &&
        profileAllows(session.device, "print-receipt") &&
        (await assertRequestDevice(deps, c, session).then(
          () => true,
          (error: unknown) => {
            if (codeOf(error) === "device.unauthorized") return false;
            throw error;
          },
        ));
      const read = async (tx: Transaction, saleId: string) => {
        const transport = await readEmailTransport(tx);
        if (receiptEmail) {
          return readReceiptEmailDeliveries(tx, saleId, {
            emailAvailable: await canEmailInvoice(tx, { kind: "sale", saleId }, transport),
          });
        }
        return readInvoiceDeliveries(tx, saleId, {
          emailAvailable: (sale) =>
            canEmailInvoice(tx, { kind: "sale", saleId: sale.id }, transport),
          includeInvoiceRecipientEmail: canDeliverInvoice,
          offerA4Retry: canDeliverInvoice,
          printers: () => tillInvoicePrinters(tx, session),
          testPages: deps.testPages,
        });
      };
      const current = await deps.db.withWriteLock(async () => {
        const saleId = await zonedSale(deps.db, session, id);
        if (await invoiceDeliveryClaimsDue(deps.db, new Date())) return null;
        return { status: await read(deps.db, saleId) };
      });
      const status =
        current === null
          ? await withTransaction(deps.db, async (tx) => {
              const saleId = await zonedSale(tx, session, id);
              await expireInvoiceDeliveryClaims(tx, new Date());
              return read(tx, saleId);
            })
          : current.status;
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "invoice_delivery", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<{
        medium?: unknown;
        requestKey?: unknown;
        printerId?: unknown;
        recipient?: unknown;
      }>(c);
      if (body.medium !== "print" && body.medium !== "email")
        throw new AppError("management.request_invalid", { field: "medium" });
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const request = { requestKey, personId: session.personId };
      if (body.medium === "print") {
        const printerId = requireBodyUuid(body.printerId, "printerId");
        const attempt = await withTransaction(deps.db, async (tx) =>
          requestPrintDelivery(
            tx,
            { backend: deps.backend, cfg: requestCfg(deps.cfg, session) },
            { id: await zonedSale(tx, session, id), workingOrderId: id },
            () => tillInvoicePrinters(tx, session),
            { ...request, printerId, offerA4Retry: true },
          ),
        );
        return c.json(attempt);
      }
      const recipient = requireRecipient(body.recipient);
      const attempt = await withTransaction(deps.db, async (tx) => {
        const transport = (await deps.invoiceEmailAvailable?.(tx)) === true;
        return requestEmailDelivery(tx, await zonedSale(tx, session, id), {
          ...request,
          recipient,
          transport,
        });
      });
      return c.json(attempt);
    }),
  );

  app.post("/api/sales/:id/deliveries/:deliveryId/to-receipt", (c) =>
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
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const deliveryId = c.req.param("deliveryId");
      const body = await readJsonBody<{ requestKey?: unknown }>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const attempt = await withTransaction(deps.db, async (tx) => {
        const saleId = await zonedSale(tx, session, id);
        return switchToReceipt(
          tx,
          { backend: deps.backend, cfg },
          { id: saleId, workingOrderId: id },
          () => tillInvoicePrinters(tx, session),
          deliveryId,
          { requestKey, personId: session.personId },
        );
      });
      return c.json(attempt);
    }),
  );

  app.post("/api/sales/:id/deliveries/:deliveryId/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(
        deps,
        c,
        "print-receipt",
        "invoice_delivery_retry",
        session.device,
      );
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const deliveryId = c.req.param("deliveryId");
      const body = await readJsonBody<{ requestKey?: unknown }>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const attempt = await withTransaction(deps.db, async (tx) => {
        const transport = (await deps.invoiceEmailAvailable?.(tx)) === true;
        return retryEmailDelivery(tx, await zonedSale(tx, session, id), deliveryId, {
          requestKey,
          personId: session.personId,
          transport,
        });
      });
      return c.json(attempt);
    }),
  );

  // Document actions use the working-order id and never enqueue drawer commands.
  // A filed but unpaid invoice renders without a payment block.
  app.post("/api/sales/:id/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const { ifOwed } = await readJsonBody<{ ifOwed?: unknown }>(c);
      if (ifOwed !== undefined && typeof ifOwed !== "boolean")
        throw new AppError("management.request_invalid", { field: "ifOwed" });
      await printSaleReceipt(
        { db: deps.db, backend: deps.backend },
        cfg,
        id,
        ifOwed === true ? "owed" : "original",
        { personId: session.personId },
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/sales/:id/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const { language } = await readJsonBody<{ language?: unknown }>(c);
      if (language !== undefined && typeof language !== "string") {
        throw new AppError("management.request_invalid", { field: "language" });
      }
      await reprintSale(
        { db: deps.db, backend: deps.backend },
        cfg,
        id,
        language,
        session.personId,
      );
      return c.body(null, 200);
    }),
  );
}
