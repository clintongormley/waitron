import { readJsonBody, type Logger } from "@waitron/server-kit";
import { isUuid } from "@waitron/shared";
import type { Hono } from "hono";
import type { SetupDeps } from "./setup-api-deps.js";
import { directError, runRestore } from "./setup-api-errors.js";
import { asString, invalidRequest } from "./setup-request-fields.js";

export function mountSetupCloudRecoverySessionRoutes(
  app: Hono,
  deps: SetupDeps,
  log: Logger,
  setupBusy: () => boolean,
): void {
  app.post("/setup-api/cloud-recovery/start", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.start(), 200));
  });
  app.get("/setup-api/cloud-recovery/status", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.status(), 200));
  });
  app.get("/setup-api/cloud-recovery/points", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.points()));
  });
  app.post("/setup-api/cloud-recovery/select", async (c) => {
    const recovery = deps.cloudRecovery;
    if (!recovery) return directError(c, log, "setup.not_ready", 503);
    if (setupBusy()) return directError(c, log, "setup.already_provisioning", 409);
    return runRestore(c, log, async () => {
      const body = await readJsonBody<{ pointId?: unknown; venueId?: unknown }>(c);
      const pointId = asString(body.pointId, "pointId");
      const venueId = asString(body.venueId, "venueId");
      if (!isUuid(pointId)) invalidRequest("pointId");
      if (!isUuid(venueId)) invalidRequest("venueId");
      return c.json(await recovery.select(pointId.toLowerCase(), venueId.toLowerCase()));
    });
  });
  app.post("/setup-api/cloud-recovery/start-again", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.startAgain(), 200));
  });
}
