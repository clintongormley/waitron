import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { withTransaction, type Database } from "@waitron/db";
import type { IssueScope } from "@waitron/fiscal";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import { confirmVenueZone, readVenueZoneRepair } from "./venue-zone-repair.js";
import { restartAfterResponse } from "./restart-after-response.js";
import type { TradingAdmission } from "./trading-admission.js";
import "./errors.js";

const run = createErrorBoundary(
  {
    "management_session.required": 401,
    "management_session.expired": 401,
    "person.suspended": 403,
    "authorization.not_permitted": 403,
    "management.request_invalid": 400,
    "venue.business_day_changed": 409,
    "venue.time_zone_repair_not_needed": 409,
  },
  "management.failed",
);

export function mountVenueZoneRepairApi(
  app: Hono,
  deps: {
    db: Database;
    scope: IssueScope;
    admission: TradingAdmission;
    managementOrigin: string;
    requestRestart: () => void;
    now: () => Date;
  },
  log: Logger,
): void {
  const path = "/management-api/venue-details/time-zone-repair";
  app.get(path, (c) =>
    run(c, log, async () => {
      if (c.req.header("origin") !== deps.managementOrigin)
        throw new AppError("authorization.not_permitted", { permission: "venue.configure" });
      const session = requireManagementSession(c);
      const query = c.req.query();
      if (Object.keys(query).some((key) => key !== "timeZone"))
        throw new AppError("management.request_invalid", { field: "query" });
      const model = await withTransaction(deps.db, (tx) =>
        readVenueZoneRepair(
          tx,
          deps.scope,
          session,
          deps.admission.snapshot(),
          deps.now(),
          query.timeZone,
        ),
      );
      return c.json(model);
    }),
  );
  app.post(path, (c) =>
    run(c, log, async () => {
      if (c.req.header("origin") !== deps.managementOrigin)
        throw new AppError("authorization.not_permitted", { permission: "venue.configure" });
      const session = requireManagementSession(c);
      if (
        c.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
      )
        throw new AppError("management.request_invalid", { field: "body" });
      const input = await readJsonBody<unknown>(c);
      const outgoing = (c.env as HttpBindings).outgoing;
      if (outgoing === undefined) throw new Error("Missing response lifecycle");
      const result = await withTransaction(deps.db, (tx) =>
        confirmVenueZone(tx, deps.scope, session, input, deps.now()),
      );
      deps.admission.requireRestart();
      restartAfterResponse(outgoing, deps.requestRestart);
      return c.json(result);
    }),
  );
}
