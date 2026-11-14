import "./errors.js";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { requireFreshManagementSignIn } from "@waitron/identity";
import type { ModuleRouteContext } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  type Logger,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  ACCEPTED_WITH_ERRORS_CORRECTION,
  admitRecordRemedy,
  REMEDY_KINDS,
  type RemedyKind,
  type RemedyPolicy,
} from "./record-remedy.js";
import { applyCorrectedRecordFacts } from "./record-remedy-http.js";
import { applyAbsentOriginalCancellation } from "./record-remedy-absent.js";
import { releaseHeldCancellation } from "./record-remedy-held.js";
import { applyCorrectiveInvoiceRequest } from "./record-remedy-corrective-http.js";
import { releaseRecordBrake } from "./record-remedy-brake.js";
import { REMEDY_REFUSALS } from "./remedy-refusals.js";

// Legal enablement belongs to server policy; a client request cannot grant it. Without
// ACCEPTED_WITH_ERRORS_CORRECTION a correction record for a case AEAT accepted with errors is
// refused; the returned-record allowance below adds it for a former main's records.
const ENABLED_REMEDIES: RemedyPolicy = new Set(["record-correction"]);

const run = createErrorBoundary(REMEDY_REFUSALS, "fiscal-remedy.failed");

export function mountRecordRemedies(
  app: Hono,
  ctx: Pick<ModuleRouteContext, "db" | "recordGeneration">,
  log: Logger,
  enabledRemedies: RemedyPolicy = ENABLED_REMEDIES,
): void {
  app.post("/management-api/fiscal-records/remedy", (c) =>
    run(c, log, async () => {
      c.header("Cache-Control", "no-store");
      const token = requireManagementSession(c);
      const body = await readJsonBody<unknown>(c);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        !("kind" in body) ||
        typeof body.kind !== "string" ||
        !REMEDY_KINDS.includes(body.kind as RemedyKind)
      ) {
        throw new AppError("fiscal.remedy_request_invalid", {});
      }
      const kind = body.kind as RemedyKind;
      const result = await withTransaction(ctx.db, async (tx) => {
        let allowed = enabledRemedies;
        if (kind === "record-correction" && ctx.recordGeneration?.returnSource) {
          const source = await ctx.recordGeneration.returnSource(tx);
          const raw = body as Record<string, unknown>;
          const [target] =
            typeof raw.registroId === "string"
              ? tx.all<{ node_id: string }>(
                  sql`select node_id from registros_facturacion where id = ${raw.registroId}`,
                )
              : [];
          if (source && source !== ctx.recordGeneration.nodeId && target?.node_id === source)
            allowed = new Set([
              ...enabledRemedies,
              "record-correction",
              ACCEPTED_WITH_ERRORS_CORRECTION,
            ]);
        }
        await admitRecordRemedy(tx, token, kind, allowed);
        if (ctx.recordGeneration === undefined)
          throw new AppError("fiscal.remedy_disabled", { kind });
        ctx.recordGeneration.requireClockConfirmed();
        await requireFreshManagementSignIn(tx, token);
        if (kind === "record-correction")
          return applyCorrectedRecordFacts(tx, ctx.recordGeneration, token, allowed, body);
        if (kind === "absent-original-cancellation")
          return applyAbsentOriginalCancellation(
            tx,
            ctx.recordGeneration,
            token,
            enabledRemedies,
            body,
          );
        if (kind === "corrective-invoice")
          return applyCorrectiveInvoiceRequest(
            tx,
            ctx,
            ctx.recordGeneration,
            token,
            enabledRemedies,
            body,
          );
        if (kind === "release-held-cancellation")
          return releaseHeldCancellation(tx, ctx.recordGeneration, token, enabledRemedies, body);
        if (kind === "release-brake")
          return releaseRecordBrake(tx, ctx.recordGeneration, token, enabledRemedies, body);
        throw new AppError("fiscal.remedy_disabled", { kind });
      });
      return c.json(result, 200);
    }),
  );
}
