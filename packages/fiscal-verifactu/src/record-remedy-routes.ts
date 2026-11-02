import "./errors.js";
import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import type { ModuleRouteContext } from "@waitron/module";
import {
  createErrorBoundary,
  readJsonBody,
  requireManagementSession,
  type Logger,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { admitRecordRemedy, REMEDY_KINDS, type RemedyKind } from "./record-remedy.js";
import { applyCorrectedRecordFacts } from "./record-remedy-http.js";

// Legal enablement belongs to server policy; a client request cannot grant it.
const ENABLED_REMEDIES: ReadonlySet<RemedyKind> = new Set();

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "fiscal.remedy_disabled": 409,
    "fiscal.remedy_invalid": 400,
    "filing_case.action_mismatch": 409,
    "filing_case.already_resolved": 409,
    "fiscal.record_already_corrected": 409,
    "node.read_only": 409,
    "clock.behind_chain": 409,
    "clock.unusable": 409,
    "venue.time_zone_not_ready": 409,
  },
  "fiscal-remedy.failed",
);

export function mountRecordRemedies(
  app: Hono,
  ctx: Pick<ModuleRouteContext, "db" | "recordGeneration">,
  log: Logger,
  enabledRemedies: ReadonlySet<RemedyKind> = ENABLED_REMEDIES,
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
        await admitRecordRemedy(tx, token, kind, enabledRemedies);
        if (kind !== "record-correction" || ctx.recordGeneration === undefined)
          throw new AppError("fiscal.remedy_disabled", { kind });
        return applyCorrectedRecordFacts(tx, ctx.recordGeneration, token, enabledRemedies, body);
      });
      return c.json(result, 200);
    }),
  );
}
