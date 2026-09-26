import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database } from "@waitron/db";
import { authorizeManager } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { clearRemovedMachine, listServers, removeUnjoinedStandby } from "./membership-removal.js";
import { CHART_MINT_REFUSALS } from "./membership-mint.js";
import type { Logger } from "./logger.js";

export interface MembershipRemovalApiDeps {
  db: Database;
  ring: KeyRing;
  nodeId: string;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "membership.node_not_found": 404,
  "membership.not_primary": 409,
  "membership.node_is_primary": 409,
  "membership.node_has_served": 409,
  "membership.standby_joined": 409,
  "membership.node_not_removed": 409,
  ...CHART_MINT_REFUSALS,
  "membership.write_contended": 503,
};

export function mountMembershipRemovalApi(
  app: Hono,
  deps: MembershipRemovalApiDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "membership.removal_failed");
  const runClear = createErrorBoundary(STATUS, "membership.clearance_failed");

  // Admin-only, the same permission that hands a standby its bundle.
  const authorize = (sessionId: string): Promise<string> =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "mirror.create",
      });
      return authorizedBy;
    });

  app.get("/management-api/servers", (c) =>
    run(c, log, async () => {
      await authorize(requireManagementSession(c));
      return c.json(await listServers(deps.db, deps.nodeId));
    }),
  );

  app.post("/management-api/servers/:nodeId/remove", (c) =>
    run(c, log, async () => {
      // Authorized before the id is looked at, so a caller without the permission learns nothing
      // about which ids the chart lists.
      const personId = await authorize(requireManagementSession(c));
      const targetNodeId = c.req.param("nodeId");
      const result = await removeUnjoinedStandby(
        { db: deps.db, ring: deps.ring, nodeId: deps.nodeId, log },
        { targetNodeId, personId },
      );
      return c.json(result);
    }),
  );

  app.post("/management-api/servers/:nodeId/clear", (c) =>
    runClear(c, log, async () => {
      const personId = await authorize(requireManagementSession(c));
      const result = await clearRemovedMachine(
        { db: deps.db, ring: deps.ring, nodeId: deps.nodeId, log },
        { targetNodeId: c.req.param("nodeId"), personId },
      );
      return c.json(result);
    }),
  );
}
