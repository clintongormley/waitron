import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { readPersonAuthority } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { giveBack, planGiveBack, readGiveBack, type GiveBackWriteDeps } from "./give-back.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, pathId } from "./tender-refund-api.js";
import { STATUS, type TillApiDeps } from "./till-api.js";
import { assertRequestDevice, requireSession } from "./till-session.js";
import "./errors.js";

/** The Give money back window's read and preview, which write nothing, and its write. */
export function mountGiveBackApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  const giveBackDeps: GiveBackWriteDeps = {
    backend: deps.backend,
    admission: deps.admission,
    clock: deps.clock,
    attendance: deps.attendance,
    refundProviderFor: refundProvidersOf({
      simulator: deps.refundSimulator ?? deps.cardProvider,
      pool: deps.pool,
    }),
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
      const result = await withTransaction(deps.db, async (tx) => {
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
          },
          body,
        );
      });
      return c.json(result);
    }),
  );
}
