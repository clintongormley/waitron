import type { Hono } from "hono";
import { withTransaction } from "@waitron/db";
import { authorize, type PinThrottle } from "@waitron/identity";
import { readRawJsonBody, requireUuidParam } from "@waitron/server-kit";
import { isUuid } from "@waitron/shared";
import { asObject } from "./bill-payments-api.js";
import { invalid } from "./bill-allocation.js";
import type { Logger } from "./logger.js";
import { VENUE_SERVICE } from "./modules.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestCfg } from "./request-config.js";
import { overridePinAttempts, parseOverrideField, type Run, type TillApiDeps } from "./till-api.js";
import { requireSession } from "./till-session.js";
import { gateZones } from "./zone-access.js";
import "./errors.js";

export function mountKeepOpenApi(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  run: Run,
  pinThrottle: PinThrottle,
): void {
  app.get("/api/service-zones/:zoneId/keep-open", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      await gateZones(deps, session, [{ zoneId }]);
      const cfg = requestCfg(deps.cfg, session);
      return c.json(
        await withTransaction(deps.db, (tx) =>
          VENUE_SERVICE.readKeepOpen(tx, cfg, zoneId, new Date()),
        ),
      );
    }),
  );
  app.put("/api/service-zones/:zoneId/period-extension", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      await gateZones(deps, session, [{ zoneId }]);
      const cfg = requestCfg(deps.cfg, session);
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (typeof body.periodId !== "string" || !isUuid(body.periodId)) throw invalid("periodId");
      if (body.until !== null && typeof body.until !== "string") throw invalid("until");
      const input = { periodId: body.periodId.toLowerCase(), until: body.until };
      const override = parseOverrideField(body.override);
      const authz = { sessionId: session.sessionId, permission: "venue_service.manage" };
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await overrideToCheck(deps.db, authz, override);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await authorize(tx, { ...authz, override: withCheck(override, checked) }, attempts);
          await VENUE_SERVICE.keepPeriodOpen(tx, cfg, zoneId, input, new Date());
        }),
      );
      return c.body(null, 204);
    }),
  );
  app.put("/api/service-zones/:zoneId/zone-extension", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      await gateZones(deps, session, [{ zoneId }]);
      const cfg = requestCfg(deps.cfg, session);
      const body = asObject(await readRawJsonBody<unknown>(c));
      if (body.until !== null && typeof body.until !== "string") throw invalid("until");
      const input = { until: body.until };
      const override = parseOverrideField(body.override);
      const authz = { sessionId: session.sessionId, permission: "venue_service.manage" };
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await overrideToCheck(deps.db, authz, override);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await authorize(tx, { ...authz, override: withCheck(override, checked) }, attempts);
          await VENUE_SERVICE.keepZoneOpen(tx, cfg, zoneId, input, new Date());
        }),
      );
      return c.body(null, 204);
    }),
  );
}
