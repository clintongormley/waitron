import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { saleId as brandSaleId } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { lineIdsOf, previewInvoiceCorrection } from "./invoice-corrections.js";
import type { Logger } from "./logger.js";
import { requestCfg } from "./request-config.js";
import { checkAccess, pathId } from "./tender-refund-api.js";
import { STATUS, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

export function mountInvoiceCorrectionApi(app: Hono, deps: TillApiDeps, log: Logger): void {
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
}
