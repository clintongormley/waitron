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

// Legal enablement belongs to server policy; a client request cannot grant it.
const ENABLED_REMEDIES: ReadonlySet<RemedyKind> = new Set();

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "fiscal.remedy_disabled": 409,
  },
  "fiscal-remedy.failed",
);

export function mountRecordRemedies(
  app: Hono,
  ctx: Pick<ModuleRouteContext, "db">,
  log: Logger,
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
      await withTransaction(ctx.db, (tx) =>
        admitRecordRemedy(tx, token, body.kind as RemedyKind, ENABLED_REMEDIES),
      );
      // Enabling a remedy also requires its typed request adapter and trusted node/clock binding.
      throw new AppError("fiscal.remedy_disabled", { kind: body.kind });
    }),
  );
}
