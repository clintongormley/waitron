import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { authorize, listActivePersonsWithPermission, type PinThrottle } from "@waitron/identity";
import { readRawJsonBody } from "@waitron/server-kit";
import { AppError, isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { invalid } from "./bill-allocation.js";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { overridePinAttempts, parseOverrideField, type Run, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import "./errors.js";

function stationId(value: string): string {
  if (!isUuid(value)) throw new AppError("station.not_found", { stationId: value });
  return value.toLowerCase();
}

export function mountStationTodayApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  app.get("/api/service-day/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await withTransaction(deps.db, (tx) =>
          listActivePersonsWithPermission(tx, "venue_service.manage"),
        ),
      );
    }),
  );
  app.get("/api/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, session);
      const destinations = await withTransaction(deps.db, (tx) =>
        VENUE_SERVICE.stationDestinations(tx, cfg, id, new Date()),
      );
      return c.json({ destinations });
    }),
  );
  app.put("/api/stations/:stationId/today", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = stationId(c.req.param("stationId"));
      const cfg = requestCfg(deps.cfg, session);
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (body.state !== "open" && body.state !== "closed") throw invalid("state");
      const state = body.state;
      let destination: string | undefined;
      if (state === "closed") {
        if (typeof body.sendsToStationId !== "string" || !isUuid(body.sendsToStationId))
          throw invalid("sendsToStationId");
        destination = body.sendsToStationId.toLowerCase();
      }
      const override = parseOverrideField(body.override);
      const authz = { sessionId: session.sessionId, permission: "venue_service.manage" };
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await overrideToCheck(deps.db, authz, override);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await authorize(tx, { ...authz, override: withCheck(override, checked) }, attempts);
          if (state === "closed")
            await VENUE_SERVICE.closeStationForToday(tx, cfg, id, destination!, new Date());
          else await VENUE_SERVICE.openStationForToday(tx, cfg, id, new Date());
        }),
      );
      return c.body(null, 204);
    }),
  );
}
