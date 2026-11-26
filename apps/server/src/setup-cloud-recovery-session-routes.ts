import type { Logger } from "@waitron/server-kit";
import type { Hono } from "hono";
import type { SetupDeps } from "./setup-api-deps.js";
import { directError, runRestore } from "./setup-api-errors.js";

export function mountSetupCloudRecoverySessionRoutes(
  app: Hono,
  deps: SetupDeps,
  log: Logger,
): void {
  app.post("/setup-api/cloud-recovery/start", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.start(), 200));
  });
  app.get("/setup-api/cloud-recovery/status", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.status(), 200));
  });
  app.post("/setup-api/cloud-recovery/start-again", async (c) => {
    if (!deps.cloudRecovery) return directError(c, log, "setup.not_ready", 503);
    return runRestore(c, log, async () => c.json(await deps.cloudRecovery!.startAgain(), 200));
  });
}
