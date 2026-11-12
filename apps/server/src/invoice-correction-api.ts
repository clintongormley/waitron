import type { Hono } from "hono";
import { withTransaction, type Transaction } from "@waitron/db";
import type { AuthzInput, PinThrottle } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid, saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { withCorrectionAuthorization } from "./invoice-correction-authorization.js";
import { readCorrectionRow } from "./invoice-correction-legs.js";
import { giveCorrectionCash, parseCorrectionCash } from "./invoice-correction-cash.js";
import {
  closeInvoiceCorrection,
  expectedSplitOf,
  fileInvoiceCorrectionNow,
  lineIdsOf,
  listOpenInvoiceCorrections,
  openInvoiceCorrection,
  parseInvoiceCorrection,
  previewInvoiceCorrection,
  readInvoiceCorrection,
  type InvoiceCorrectionRequest,
  type InvoiceCorrectionView,
} from "./invoice-corrections.js";
import type { Logger } from "./logger.js";
import { withCheck } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, overrideOf, pathId } from "./tender-refund-api.js";
import { overridePinAttempts, STATUS, type TillApiDeps } from "./till-api.js";
import { requireEconomicWrite } from "./trading-admission.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import { orderZoneCondition } from "./zone-access.js";
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
      "sale.correction_amount_invalid": 409,
      "sale.correction_scope_invalid": 400,
      "sale.correction_history_unusable": 409,
      "sale.correction_not_admitted": 409,
      "adjustment_reason.not_found": 400,
      "invoice_correction.not_settled": 409,
      "invoice_correction.already_open": 409,
      "invoice_correction.money_short": 409,
      "invoice_correction.split_changed": 409,
      "invoice_correction.chain_unsound": 409,
      "invoice_correction.not_open": 409,
      "invoice_correction.leg_too_large": 409,
      "invoice_correction.cash_short": 409,
      "invoice_correction.nothing_back": 409,
      "invoice_correction.still_correctable": 409,
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
      const ask = parseInvoiceCorrection(body as unknown as InvoiceCorrectionRequest);
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
            ask,
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
      // Read apart only to name the invoice whose zones authorization checks; the write
      // transaction reads the correction again.
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
        { permission: "sale.refund", tender: "cash" },
      );
      return c.json(result);
    }),
  );
  const endingRoute = <R>(
    path: "file" | "close",
    parse: (body: Record<string, unknown>) => R,
    end: (
      tx: Transaction,
      cfg: ReturnType<typeof requestCfg>,
      correctionId: string,
      request: R,
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
        const request = parse(body);
        const override = overrideOf(body);
        // Read apart only to name the invoice whose zones authorization checks; the write
        // transaction reads the correction again.
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
            return end(tx, cfg, correctionId, request, {
              personId: session.personId,
              authz: { sessionId: session.sessionId, override: withCheck(override, checked) },
            });
          },
        );
        return c.json(result);
      }),
    );
  const correctionDeps = { backend: deps.backend, clock: deps.clock, attendance: deps.attendance };
  endingRoute(
    "file",
    (body) => ({ expectedSplit: expectedSplitOf(body.expectedSplit) }),
    (tx, cfg, correctionId, request, actor) =>
      fileInvoiceCorrectionNow(tx, correctionDeps, cfg, correctionId, request, actor),
  );
  endingRoute(
    "close",
    () => undefined,
    (tx, cfg, correctionId, _request, actor) =>
      closeInvoiceCorrection(tx, correctionDeps, cfg, correctionId, { personId: actor.personId }),
  );
  app.get("/api/invoice-corrections", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const corrections = await withTransaction(deps.db, async (tx) =>
        listOpenInvoiceCorrections(
          tx,
          await orderZoneCondition(tx, session.device.deviceProfileId),
        ),
      );
      return c.json({ corrections });
    }),
  );
  app.get("/api/invoice-corrections/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const correctionId = correctionIdOf(c.req.param("id"));
      const result = await withTransaction(deps.db, async (tx) => {
        await checkAccess(tx, session, await saleOfCorrection(tx, correctionId));
        return readInvoiceCorrection(tx, deps.backend, requestCfg(deps.cfg, session), correctionId);
      });
      return c.json(result);
    }),
  );
}

/** The invoice the correction `correctionId` corrects; refused `invoice_correction.not_found`. */
async function saleOfCorrection(tx: Transaction, correctionId: string): Promise<string> {
  return (await readCorrectionRow(tx, correctionId)).originalSaleId;
}

function correctionIdOf(raw: string): string {
  if (!isUuid(raw)) throw new AppError("invoice_correction.not_found", { correctionId: raw });
  return raw.toLowerCase();
}
