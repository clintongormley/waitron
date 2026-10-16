import type { Hono } from "hono";
import { receiptReprints, withTransaction } from "@waitron/db";
import { readJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { assertDeviceCapability } from "./device-session.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import type { Logger } from "./logger.js";
import { enqueueReceiptCopy, resolveReceiptPrinter } from "./receipt-print.js";
import { requestCfg } from "./request-config.js";
import type { Run, TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";
import { checkZones } from "./zone-access.js";
import "./errors.js";
function parsedId(value: string): string {
  if (!isUuid(value)) throw new AppError("sale.not_found", { saleId: value });
  return value.toLowerCase();
}
export function mountTransactionReceiptApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
): void {
  app.get("/api/transactions/:saleId/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c),
        id = parsedId(c.req.param("saleId"));
      const result = await withTransaction(deps.db, async (tx) => {
        const scope = await resolveTransactionScope(tx, deps.cfg, id);
        await checkZones(
          tx,
          deps.cfg,
          session,
          scope.workingOrderIds.map((orderId) => ({ orderId })),
        );
        return readTransactionReceipt(deps.backend, tx, deps.cfg, id);
      });
      return c.json(result);
    }),
  );
  app.post("/api/transactions/:saleId/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      const id = parsedId(c.req.param("saleId"));
      const { language } = await readJsonBody<{ language?: unknown }>(c);
      if (language !== undefined && typeof language !== "string")
        throw new AppError("management.request_invalid", { field: "language" });
      const cfg = requestCfg(deps.cfg, session);
      await withTransaction(deps.db, async (tx) => {
        const scope = await resolveTransactionScope(tx, cfg, id);
        await checkZones(
          tx,
          cfg,
          session,
          scope.workingOrderIds.map((orderId) => ({ orderId })),
        );
        const ticket = await readTransactionReceipt(deps.backend, tx, cfg, id);
        if (
          language !== undefined &&
          language !== ticket.locale &&
          !(await readOfferedReceiptLanguages(tx, cfg)).includes(language)
        )
          throw new AppError("management.request_invalid", { field: "language" });
        const printer = await resolveReceiptPrinter(tx, cfg.origin);
        if (printer === undefined) return;
        const copy = await enqueueReceiptCopy(
          tx,
          cfg,
          ticket,
          id,
          printer,
          language,
          session.personId,
        );
        if (copy !== undefined)
          await tx
            .insert(receiptReprints)
            .values({ saleId: id, printJobId: copy.jobId, personId: session.personId });
      });
      return c.body(null, 200);
    }),
  );
}
