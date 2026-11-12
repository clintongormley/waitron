import type { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { invoiceCorrections, tenders, withTransaction, type Transaction } from "@waitron/db";
import type { AuthzInput, PinThrottle } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { withCorrectionAuthorization } from "./invoice-correction-authorization.js";
import {
  giveCorrectionCash,
  parseCorrectionCash,
  readCashLeft,
} from "./invoice-correction-cash.js";
import {
  closeInvoiceCorrection,
  expectedSplitOf,
  fileInvoiceCorrectionNow,
  lineIdsOf,
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
  type InvoiceCorrectionRequest,
  type InvoiceCorrectionView,
  type SplitLine,
} from "./invoice-corrections.js";
import type { Logger } from "./logger.js";
import { withCheck } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
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
      "invoice_correction.not_open": 409,
      "invoice_correction.leg_too_large": 409,
      "invoice_correction.cash_short": 409,
      "invoice_correction.nothing_back": 409,
      "invoice_correction.still_correctable": 409,
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
  app.post("/api/invoice-corrections/:id/cash", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session);
      const correctionId = correctionIdOf(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const ask = parseCorrectionCash({ submissionId: body.submissionId, amount: body.amount });
      const override = overrideOf(body);
      const { saleId, tenderId } = await withTransaction(deps.db, async (tx) => {
        const [row] = await tx
          .select({ saleId: invoiceCorrections.originalSaleId })
          .from(invoiceCorrections)
          .where(eq(invoiceCorrections.id, correctionId));
        if (row === undefined) throw new AppError("invoice_correction.not_found", { correctionId });
        const [holding] = await readCashLeft(tx, row.saleId);
        const [oldest] = await tx
          .select({ id: tenders.id })
          .from(tenders)
          .where(and(eq(tenders.saleId, row.saleId), eq(tenders.method, "cash")))
          .orderBy(asc(tenders.settledAt), asc(tenders.id));
        return { saleId: row.saleId, tenderId: holding?.tenderId ?? oldest?.id ?? "" };
      });
      const result = await withTenderRefundAuthorization(
        deps.db,
        cfg,
        saleId,
        {
          submissionId: ask.submissionId,
          tenderId,
          appliedAmount: ask.amount,
          tipAmount: "0.00",
          reason: "",
          override,
        },
        {
          personId: session.personId,
          sessionId: session.sessionId,
          attempts: overridePinAttempts(pinThrottle, session.deviceId),
        },
        async (tx, authorization, checked) => {
          await requireEconomicWrite(tx, cfg, deps.admission);
          return giveCorrectionCash(
            tx,
            { backend: deps.backend, clock: deps.clock, attendance: deps.attendance },
            cfg,
            correctionId,
            ask,
            {
              personId: session.personId,
              authz: { sessionId: session.sessionId, override: withCheck(override, checked) },
              authorization,
            },
          );
        },
      );
      return c.json(result);
    }),
  );
  const endingRoute = (
    path: "file" | "close",
    end: (
      tx: Transaction,
      cfg: ReturnType<typeof requestCfg>,
      correctionId: string,
      body: Record<string, unknown>,
      actor: { personId: string; authz: AuthzInput },
    ) => Promise<InvoiceCorrectionView>,
  ) =>
    app.post(`/api/invoice-corrections/:id/${path}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c);
        await assertRequestDevice(deps, c, session);
        const cfg = requestCfg(deps.cfg, session);
        const correctionId = correctionIdOf(c.req.param("id"));
        const body = asObject(await readRawJsonBody<unknown>(c));
        if (path === "file") expectedSplitOf(body.expectedSplit);
        const override = overrideOf(body);
        const saleId = await withTransaction(deps.db, (tx) => saleOfCorrection(tx, correctionId));
        const result = await withCorrectionAuthorization(
          deps.db,
          saleId,
          override,
          {
            personId: session.personId,
            sessionId: session.sessionId,
            deviceId: session.deviceId,
            attempts: overridePinAttempts(pinThrottle, session.deviceId),
          },
          async (tx, _authorization, checked) => {
            await requireEconomicWrite(tx, cfg, deps.admission);
            return end(tx, cfg, correctionId, body, {
              personId: session.personId,
              authz: { sessionId: session.sessionId, override: withCheck(override, checked) },
            });
          },
        );
        return c.json(result);
      }),
    );
  const correctionDeps = { backend: deps.backend, clock: deps.clock, attendance: deps.attendance };
  endingRoute("file", (tx, cfg, correctionId, body, actor) =>
    fileInvoiceCorrectionNow(
      tx,
      correctionDeps,
      cfg,
      correctionId,
      { expectedSplit: body.expectedSplit as SplitLine[] },
      actor,
    ),
  );
  endingRoute("close", (tx, cfg, correctionId, _body, actor) =>
    closeInvoiceCorrection(tx, correctionDeps, cfg, correctionId, { personId: actor.personId }),
  );
  app.get("/api/invoice-corrections/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const correctionId = correctionIdOf(c.req.param("id"));
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

/** The invoice the correction `correctionId` corrects; refused `invoice_correction.not_found`. */
async function saleOfCorrection(tx: Transaction, correctionId: string): Promise<string> {
  const [row] = await tx
    .select({ saleId: invoiceCorrections.originalSaleId })
    .from(invoiceCorrections)
    .where(eq(invoiceCorrections.id, correctionId));
  if (row === undefined) throw new AppError("invoice_correction.not_found", { correctionId });
  return row.saleId;
}

function correctionIdOf(raw: string): string {
  if (!isUuid(raw)) throw new AppError("invoice_correction.not_found", { correctionId: raw });
  return raw.toLowerCase();
}
