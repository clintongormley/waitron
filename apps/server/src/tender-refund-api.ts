import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { refunds, receiptReprints, withTransaction, type Transaction } from "@waitron/db";
import type { PinThrottle, Override } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, centsToDecimal, isUuid } from "@waitron/shared";
import { invalid } from "./bill-allocation.js";
import { asObject } from "./bill-payments-api.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { assertDeviceCapability } from "./device-session.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import {
  authorizeStoredTenderRefund,
  readRefundableTendersWithLimits,
} from "./tender-refund-reservation.js";
import { refundSettledTender, toTenderRefundView } from "./tender-refunds.js";
import {
  claimTenderRefund,
  resolveClaimedTenderRefund,
  tenderRefundIsLive,
} from "./tender-refund-sends.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import { overridePinAttempts, parseOverrideField, STATUS, type TillApiDeps } from "./till-api.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import { enqueuePrintJob } from "@waitron/printing";
import { resolveReceiptPrinter } from "./receipt-print.js";
import {
  readTenderRefundAcknowledgment,
  formatTenderRefundAcknowledgment,
} from "./tender-refund-receipt.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";
import "./errors.js";

export function pathId(value: string, kind: "sale" | "refund"): string {
  if (!isUuid(value))
    throw kind === "sale"
      ? new AppError("sale.not_found", { saleId: value })
      : new AppError("tender.refund_not_found", { refundId: value });
  return value.toLowerCase();
}

async function readRefund(tx: Transaction, id: string) {
  const [row] = await tx.select().from(refunds).where(eq(refunds.id, id));
  if (row === undefined || row.saleId === null || row.tenderId === null)
    throw new AppError("tender.refund_not_found", { refundId: id });
  return { ...row, saleId: row.saleId, tenderId: row.tenderId };
}
export function overrideOf(body: Record<string, unknown>): Override | undefined {
  if (body.override === null) throw invalid("override");
  return parseOverrideField(body.override);
}
function parseRequest(body: Record<string, unknown>): TenderRefundRequest {
  const strings = ["submissionId", "tenderId", "appliedAmount", "tipAmount", "reason"] as const;
  for (const field of strings) if (typeof body[field] !== "string") throw invalid(field);
  if (body.manualConfirmed !== undefined && typeof body.manualConfirmed !== "boolean")
    throw invalid("manualConfirmed");
  const correctionId = body.invoiceCorrectionId;
  if (correctionId !== undefined && (typeof correctionId !== "string" || !isUuid(correctionId)))
    throw invalid("invoiceCorrectionId");
  return {
    submissionId: body.submissionId as string,
    tenderId: body.tenderId as string,
    appliedAmount: body.appliedAmount as string,
    tipAmount: body.tipAmount as string,
    reason: body.reason as string,
    ...(body.manualConfirmed === undefined
      ? {}
      : { manualConfirmed: body.manualConfirmed as boolean }),
    ...(body.cancellationIds === undefined
      ? {}
      : { cancellationIds: body.cancellationIds as string[] }),
    ...(correctionId === undefined
      ? {}
      : {
          invoiceCorrection: {
            id: correctionId,
            requestId: body.submissionId as string,
          },
        }),
    override: overrideOf(body),
  };
}

export function mountTenderRefundApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  const run = createErrorBoundary(
    {
      ...STATUS,
      "sale.not_found": 404,
      "tender.refund_not_found": 404,
      "submission.id_reused": 409,
      "tender.refund_in_progress": 409,
      "tender.refund_exceeds_payment": 409,
      "tender.refund_exceeds_cancelled": 409,
      "tender.refund_needs_correction": 409,
      "sale.correction_not_admitted": 409,
      "invoice_correction.refund_pending": 409,
      "tender.refund_of_advance": 409,
      "tender.refund_unavailable": 409,
      "invoice_correction.already_open": 409,
      "invoice_correction.not_found": 404,
      "invoice_correction.not_open": 409,
      "invoice_correction.leg_too_large": 409,
      "invoice_correction.cash_route_only": 409,
    },
    "tender_refund.failed",
  );
  const commandDeps = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    cfg: deps.cfg,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor: refundProvidersOf({
      simulator: deps.refundSimulator ?? deps.cardProvider,
      pool: deps.pool,
    }),
    clockUnconfirmed: deps.clockUnconfirmed,
    log,
  };
  app.get("/api/transactions/:saleId/refundable-tenders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const id = pathId(c.req.param("saleId"), "sale");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkAccess(tx, session, id);
        return readRefundableTendersWithLimits(
          tx,
          deps.cfg.nodeId,
          { backend: deps.backend, reading: deps.clock.now() },
          id,
        );
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/refunds", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("saleId"), "sale");
      const req = parseRequest(asObject(await readRawJsonBody<unknown>(c)));
      return c.json(
        await refundSettledTender(commandDeps, cfg, id, req, {
          personId: session.personId,
          sessionId: session.sessionId,
          attempts: overridePinAttempts(pinThrottle, session.deviceId),
        }),
      );
    }),
  );
  app.get("/api/tender-refunds/:refundId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const id = pathId(c.req.param("refundId"), "refund");
      const result = await withTransaction(deps.db, async (tx) => {
        const row = await readRefund(tx, id);
        await checkAccess(tx, session, row.saleId);
        return toTenderRefundView(row);
      });
      return c.json(result);
    }),
  );
  app.get("/api/tender-refunds/:refundId/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const id = pathId(c.req.param("refundId"), "refund");
      const { acknowledgment } = await withTransaction(deps.db, (tx) =>
        readTenderRefundAcknowledgment(deps.backend, tx, id, (parent) =>
          checkAccess(tx, session, parent),
        ),
      );
      return c.json(acknowledgment);
    }),
  );
  app.post("/api/tender-refunds/:refundId/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("refundId"), "refund");
      const body = asObject(await readRawJsonBody<unknown>(c));
      const { language } = body;
      if (language !== undefined && typeof language !== "string")
        throw new AppError("management.request_invalid", { field: "language" });
      await withTransaction(deps.db, async (tx) => {
        const { acknowledgment, locale } = await readTenderRefundAcknowledgment(
          deps.backend,
          tx,
          id,
          (parent) => checkAccess(tx, session, parent),
        );
        if (
          language !== undefined &&
          language !== locale &&
          !(await readOfferedReceiptLanguages(tx)).includes(language)
        )
          throw new AppError("management.request_invalid", { field: "language" });
        if (acknowledgment.printQueued) return;
        const printer = await resolveReceiptPrinter(tx, cfg.origin);
        if (printer === undefined) throw new AppError("receipt.no_printer", {});
        const payload = formatTenderRefundAcknowledgment(
          acknowledgment,
          language ?? locale,
          printer,
        );
        const job = await enqueuePrintJob(tx, printer.id, payload, "document", {
          tenderRefundId: id,
        });
        if (acknowledgment.parent === "sale")
          await tx.insert(receiptReprints).values({
            saleId: acknowledgment.refund.saleId,
            printJobId: job.jobId,
            personId: session.personId,
          });
      });
      return c.body(null, 200);
    }),
  );
  app.post("/api/tender-refunds/:refundId/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = pathId(c.req.param("refundId"), "refund");
      const override = overrideOf(asObject(await readRawJsonBody<unknown>(c)));
      const row = await withTransaction(deps.db, async (tx) => {
        const found = await readRefund(tx, id);
        await checkAccess(tx, session, found.saleId);
        return found;
      });
      const req: TenderRefundRequest = {
        submissionId: row.submissionId,
        tenderId: row.tenderId,
        appliedAmount: centsToDecimal(row.appliedAmount),
        tipAmount: centsToDecimal(row.tipAmount),
        reason: row.reason,
        manualConfirmed: row.manual,
        override,
      };
      let release: (() => void) | undefined;
      try {
        const authorized = await withTenderRefundAuthorization(
          deps.db,
          cfg,
          row.saleId,
          req,
          {
            personId: session.personId,
            sessionId: session.sessionId,
            attempts: overridePinAttempts(pinThrottle, session.deviceId),
          },
          async (tx, authorize) => {
            const current = await readRefund(tx, id);
            await authorizeStoredTenderRefund(tx, current, authorize);
            if (current.state === "pending")
              await deps.backend.refuseUntilRecordable(tx, deps.clock.now());
            if (
              current.state === "pending" &&
              current.method === "card" &&
              !current.manual &&
              !tenderRefundIsLive(deps.db, id)
            )
              release = claimTenderRefund(deps.db, id);
            return toTenderRefundView(current);
          },
        );
        if (release === undefined) return c.json(authorized);
        const held = release;
        release = undefined;
        return c.json(await resolveClaimedTenderRefund(commandDeps, id, "retry", held));
      } catch (error) {
        release?.();
        throw error;
      }
    }),
  );
}
