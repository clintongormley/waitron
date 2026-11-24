import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { readPersonAuthority, type PinThrottle } from "@waitron/identity";
import { codeOf, createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { giveBack } from "./give-back.js";
import { planGiveBack } from "./give-back-plan.js";
import { readGiveBackOutcome, type GiveBackWriteDeps } from "./give-back-press.js";
import { readGiveBack } from "./give-back-read.js";
import { fileCorrectionAutomatically } from "./invoice-correction-alerts.js";
import type { Logger } from "./logger.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { overrideOf, pathId } from "./tender-refund-api.js";
import { checkAccess } from "./tender-refund-authorization.js";
import type { TenderRefundDeps } from "./tender-refunds.js";
import { overridePinAttempts, STATUS, type TillApiDeps } from "./till-api.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import "./errors.js";

/** The Give money back window's read and preview, which write nothing, and its write. */
export function mountGiveBackApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  const refundProviderFor = refundProvidersOf({
    simulator: deps.refundSimulator ?? deps.cardProvider,
    pool: deps.pool,
  });
  const giveBackDeps: GiveBackWriteDeps = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor,
  };
  const filingDeps: TenderRefundDeps = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    cfg: deps.cfg,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor,
    clockUnconfirmed: deps.clockUnconfirmed,
    log,
  };
  const run = createErrorBoundary(
    {
      ...STATUS,
      "sale.not_found": 404,
      "sale.correction_not_admitted": 409,
      "invoice_correction.already_open": 409,
      "invoice_correction.refund_pending": 409,
      "tender.refund_in_progress": 409,
      "tender.refund_exceeds_payment": 409,
      "tender.refund_exceeds_cancelled": 409,
      "tender.refund_of_advance": 409,
      "tender.refund_unavailable": 409,
      "tender.refund_needs_correction": 409,
      "submission.id_reused": 409,
      "give_back.changed": 409,
      "sale.correction_amount_invalid": 409,
      "sale.correction_scope_invalid": 400,
      "sale.correction_history_unusable": 409,
      "invoice_correction.not_settled": 409,
      "invoice_correction.money_short": 409,
      "invoice_correction.split_changed": 409,
      "invoice_correction.chain_unsound": 409,
      "invoice_correction.not_open": 409,
      "invoice_correction.leg_too_large": 409,
      "invoice_correction.cash_short": 409,
    },
    "give_back.failed",
  );
  app.get("/api/transactions/:saleId/give-back", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const cfg = requestCfg(deps.cfg, session),
        id = brandSaleId(pathId(c.req.param("saleId"), "sale"));
      const result = await withTransaction(deps.db, async (tx) => {
        const device = await checkAccess(tx, session, id);
        return readGiveBack(tx, giveBackDeps, cfg, deps.clock.now(), id, device);
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/give-back/preview", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      // As the write: a preview answers what pressing would.
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = brandSaleId(pathId(c.req.param("saleId"), "sale"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const result = await withTransaction(deps.db, async (tx) => {
        const device = await checkAccess(tx, session, id);
        const authority = await readPersonAuthority(tx, session.personId);
        return planGiveBack(
          tx,
          giveBackDeps,
          cfg,
          deps.clock.now(),
          id,
          { device, authority },
          body,
        );
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/give-back", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session),
        id = brandSaleId(pathId(c.req.param("saleId"), "sale"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const override = overrideOf(body);
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      // Checked whoever is signed in: the rights needed are known only inside the transaction, and
      // a separate terminal asks the PIN of a person holding them too.
      const toCheck = await overrideToCheck(
        deps.db,
        { sessionId: session.sessionId, permission: "sale.refund" },
        override,
        true,
      );
      const result = await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          const device = await checkAccess(tx, session, id);
          const authority = await readPersonAuthority(tx, session.personId);
          return giveBack(
            tx,
            giveBackDeps,
            cfg,
            id,
            {
              device,
              authority,
              personId: session.personId,
              sessionId: session.sessionId,
              override: withCheck(override, checked),
              attempts,
            },
            body,
          );
        }),
      );
      if ("onReader" in result) return c.json(await result.onReader(filingDeps));
      const { outcome, fileAfter } = result;
      if (fileAfter === null) return c.json(outcome);
      await fileCorrectionAutomatically(filingDeps, fileAfter).catch((error: unknown) => {
        log("error", "invoice_correction.automatic_filing_failed", {
          correctionId: fileAfter,
          errorCode: codeOf(error),
        });
      });
      return c.json(
        await withTransaction(deps.db, (tx) =>
          readGiveBackOutcome(tx, giveBackDeps, cfg, id, body),
        ),
      );
    }),
  );
}
