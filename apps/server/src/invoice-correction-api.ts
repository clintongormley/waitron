import type { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { saleSettlements, tenders, withTransaction } from "@waitron/db";
import type { PinThrottle } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import {
  acceptInvoiceCorrection,
  lineIdsOf,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  type InvoiceCorrectionRequest,
} from "./invoice-corrections.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, overrideOf, pathId } from "./tender-refund-api.js";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import { overridePinAttempts, STATUS, type TillApiDeps } from "./till-api.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import "./errors.js";

export function mountInvoiceCorrectionApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  const run = createErrorBoundary(
    {
      ...STATUS,
      "sale.not_found": 404,
      "submission.id_reused": 409,
      "tender.refund_unavailable": 409,
      "sale.correction_amount_invalid": 409,
      "sale.correction_scope_invalid": 400,
      "sale.correction_history_unusable": 409,
      "sale.correction_not_admitted": 409,
      "adjustment_reason.not_found": 400,
      "invoice_correction.not_settled": 409,
      "invoice_correction.not_cash": 409,
      "invoice_correction.cash_short": 409,
      "invoice_correction.split_changed": 409,
      "invoice_correction.chain_unsound": 409,
      "invoice_correction.refund_pending": 409,
    },
    "invoice_correction.failed",
  );
  app.post("/api/transactions/:saleId/corrections/preview", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session),
        id = brandSaleId(pathId(c.req.param("saleId"), "sale"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lineIds = lineIdsOf(body.lineIds);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkAccess(tx, session, id);
        return previewInvoiceCorrection(tx, deps.backend, cfg, id, {
          gross: body.gross as string,
          ...(lineIds === undefined ? {} : { lineIds }),
        });
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/corrections", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = brandSaleId(pathId(c.req.param("saleId"), "sale"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const request = parseInvoiceCorrection(body as unknown as InvoiceCorrectionRequest);
      const override = overrideOf(body);
      // The cash payment the authorization checks the device may take back.
      const [cash] = await deps.db
        .select({ id: tenders.id })
        .from(tenders)
        .where(and(eq(tenders.saleId, id), eq(tenders.method, "cash")))
        .orderBy(asc(tenders.settledAt), asc(tenders.id))
        .limit(1);
      if (cash === undefined)
        return withTransaction(deps.db, async (tx) => {
          await checkAccess(tx, session, id);
          const [settled] = await tx
            .select({ id: saleSettlements.id })
            .from(saleSettlements)
            .where(eq(saleSettlements.saleId, id));
          throw new AppError(
            settled === undefined
              ? "invoice_correction.not_settled"
              : "invoice_correction.not_cash",
            { saleId: id },
          );
        });
      const result = await withTenderRefundAuthorization(
        deps.db,
        cfg,
        id,
        {
          submissionId: request.submissionId,
          tenderId: cash.id,
          appliedAmount: request.gross,
          tipAmount: "0.00",
          reason: "",
          override,
        },
        {
          personId: session.personId,
          sessionId: session.sessionId,
          attempts: overridePinAttempts(pinThrottle, session.deviceId),
        },
        async (tx, authorization) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          return acceptInvoiceCorrection(
            tx,
            { backend: deps.backend, clock: deps.clock, attendance: deps.attendance },
            cfg,
            id,
            request,
            {
              personId: session.personId,
              authz: {
                sessionId: session.sessionId,
                ...(override === undefined ? {} : { override }),
              },
              authorization,
            },
          );
        },
      );
      return c.json(result);
    }),
  );
}
