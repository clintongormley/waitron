import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { readPersonAuthority } from "@waitron/identity";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { refundProvidersOf } from "./bill-refunds.js";
import { planGiveBack, readGiveBack, type GiveBackDeps } from "./give-back.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, pathId } from "./tender-refund-api.js";
import { STATUS, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

/** The Give money back window's read and preview; neither writes anything. */
export function mountGiveBackApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  const giveBackDeps: GiveBackDeps = {
    backend: deps.backend,
    admission: deps.admission,
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
}
