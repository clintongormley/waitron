import type { Hono } from "hono";
import { eq } from "drizzle-orm";
import { invoiceCorrections, withTransaction } from "@waitron/db";
import type { PinThrottle } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { withCorrectionAuthorization } from "./invoice-correction-authorization.js";
import {
  lineIdsOf,
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
  type InvoiceCorrectionRequest,
} from "./invoice-corrections.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, overrideOf, pathId } from "./tender-refund-api.js";
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
      "invoice_correction.not_found": 404,
      "submission.id_reused": 409,
      "tender.refund_unavailable": 409,
      "sale.correction_amount_invalid": 409,
      "sale.correction_scope_invalid": 400,
      "sale.correction_history_unusable": 409,
      "sale.correction_not_admitted": 409,
      "adjustment_reason.not_found": 400,
      "invoice_correction.not_settled": 409,
      "invoice_correction.not_cash": 409,
      "invoice_correction.already_open": 409,
      "invoice_correction.money_short": 409,
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
        return previewInvoiceCorrection(tx, deps.backend, cfg, deps.clock.now(), id, {
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
      const request = body as unknown as InvoiceCorrectionRequest;
      parseInvoiceCorrection(request);
      const override = overrideOf(body);
      const result = await withCorrectionAuthorization(
        deps.db,
        id,
        override,
        {
          personId: session.personId,
          sessionId: session.sessionId,
          deviceId: session.deviceId,
          attempts: overridePinAttempts(pinThrottle, session.deviceId),
        },
        async (tx, authorization) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          return openInvoiceCorrection(
            tx,
            { backend: deps.backend, clock: deps.clock, attendance: deps.attendance },
            cfg,
            id,
            request,
            { personId: session.personId, authorization },
          );
        },
      );
      return c.json(result);
    }),
  );
  app.get("/api/invoice-corrections/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const raw = c.req.param("id");
      if (!isUuid(raw)) throw new AppError("invoice_correction.not_found", { correctionId: raw });
      const correctionId = raw.toLowerCase();
      const result = await withTransaction(deps.db, async (tx) => {
        const [row] = await tx
          .select({ saleId: invoiceCorrections.originalSaleId })
          .from(invoiceCorrections)
          .where(eq(invoiceCorrections.id, correctionId));
        if (row === undefined) throw new AppError("invoice_correction.not_found", { correctionId });
        await checkAccess(tx, session, row.saleId);
        return readInvoiceCorrection(tx, deps.backend, requestCfg(deps.cfg, session), correctionId);
      });
      return c.json(result);
    }),
  );
}
