import type { Hono } from "hono";
import type { Database } from "@waitron/db";
import { createErrorBoundary } from "@waitron/server-kit";
import { requireDeviceProof } from "./device-session.js";
import { checkDeviceStillProven } from "./till-session.js";
import { liveStreamResponse, parseInterests } from "./live-stream.js";
import type { LiveEvents } from "./live-api.js";
import type { Logger } from "./logger.js";

const run = createErrorBoundary(
  { "device.unauthorized": 401, "management.request_invalid": 400 },
  "live.stream_failed",
);

export function mountDeviceLiveApi(
  app: Hono,
  deps: { db: Database; bus: LiveEvents; resourceTypes: readonly string[]; devMode?: boolean },
  log: Logger,
): void {
  const allowed = new Set(deps.resourceTypes);
  app.get("/api/live/events", (c) =>
    run(c, log, async () => {
      const proof = await requireDeviceProof(deps, c, { passive: true });
      const interests = parseInterests(c.req.query("resources"), allowed).map(({ type }) => ({
        type,
      }));
      return liveStreamResponse(c, {
        bus: deps.bus,
        interests,
        recheck: () => checkDeviceStillProven(deps.db, proof.device.deviceId, proof.tokenHash),
        invalidCodes: new Set(["device.unauthorized"]),
        sendIds: false,
        log,
      });
    }),
  );
}
