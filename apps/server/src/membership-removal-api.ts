import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import { createErrorBoundary, readJsonBody, requireManagementSession } from "@waitron/server-kit";
import {
  clearRemovedMachine,
  listServers,
  reloadAfterRemoval,
  removeStandby,
} from "./membership-removal.js";
import { CHART_MINT_REFUSALS } from "./membership-mint.js";
import { abandonReturn } from "./return-abandoned.js";
import type { Logger } from "./logger.js";
import type { ListedJoinRequest } from "./box-join-requests.js";

export interface MembershipRemovalApiDeps {
  readSpare?: () => Promise<import("./spare-follow.js").SpareFollowView | null>;
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  reloadStream: () => Promise<void>;
  /** The Servers screen shows it so a joining spare's person can compare it; null without one. */
  authorityFingerprint: () => Promise<string | null>;
  /** The boxes asking to join that the Servers page lists. */
  listJoinRequests?: () => ListedJoinRequest[];
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "authorization.not_permitted": 403,
  "membership.node_not_found": 404,
  "membership.not_primary": 409,
  "membership.node_is_primary": 409,
  "membership.reset_statement_required": 409,
  "membership.standby_joined": 409,
  "membership.node_not_removed": 409,
  "handover.operation_in_progress": 409,
  "handover.return_outstanding": 409,
  "handover.return_not_outstanding": 409,
  "management.request_invalid": 400,
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
  const runAbandon = createErrorBoundary(STATUS, "handover.return_abandon_failed");

  // Admin-only, the same permission that hands a standby its bundle.
  const authorize = (sessionId: string, fresh = false): Promise<string> =>
    withTransaction(deps.db, async (tx) => {
      const { authorizedBy } = await authorizeManager(tx, {
        managementSessionId: sessionId,
        permission: "node.manage",
      });
      if (fresh) await requireFreshManagementSignIn(tx, sessionId);
      return authorizedBy;
    });

  app.get("/management-api/servers", (c) =>
    run(c, log, async () => {
      await authorize(requireManagementSession(c));
      const listing = await listServers(deps.db, deps.node, deps.nodeId);
      return c.json({
        term: listing.term,
        authorityFingerprint: await deps.authorityFingerprint(),
        nodes: listing.nodes,
        ...(deps.readSpare === undefined ? {} : { spare: await deps.readSpare() }),
        ...(deps.listJoinRequests === undefined ? {} : { joinRequests: deps.listJoinRequests() }),
      });
    }),
  );

  app.post("/management-api/servers/:nodeId/remove", (c) =>
    run(c, log, async () => {
      // Authorized before the id is looked at, so a caller without the permission learns nothing
      // about which ids the chart lists.
      const personId = await authorize(requireManagementSession(c), true);
      const targetNodeId = c.req.param("nodeId");
      const body = await readJsonBody<{
        spareSwitchedOff?: unknown;
        noParallelRecovery?: unknown;
        resetStatement?: unknown;
      }>(c);
      if (body.resetStatement !== undefined && typeof body.resetStatement !== "boolean") {
        throw new AppError("management.request_invalid", { field: "resetStatement" });
      }
      const result = await removeStandby(
        { db: deps.db, node: deps.node, ring: deps.ring, nodeId: deps.nodeId, log },
        {
          targetNodeId,
          personId,
          declared: body.spareSwitchedOff === true && body.noParallelRecovery === true,
          resetStatement: body.resetStatement === true,
        },
      );
      await reloadAfterRemoval({ log, reloadStream: deps.reloadStream }, targetNodeId);
      return c.json(result);
    }),
  );

  app.post("/management-api/servers/:nodeId/return-abandoned", (c) =>
    runAbandon(c, log, async () => {
      const personId = await authorize(requireManagementSession(c), true);
      const body = await readJsonBody<{ confirmed?: unknown }>(c);
      if (body.confirmed !== true) {
        throw new AppError("management.request_invalid", { field: "confirmed" });
      }
      return c.json(await abandonReturn(deps, { sourceNodeId: c.req.param("nodeId"), personId }));
    }),
  );

  app.post("/management-api/servers/:nodeId/clear", (c) =>
    runClear(c, log, async () => {
      const personId = await authorize(requireManagementSession(c), true);
      const targetNodeId = c.req.param("nodeId");
      const result = await clearRemovedMachine(
        { db: deps.db, node: deps.node, ring: deps.ring, nodeId: deps.nodeId, log },
        { targetNodeId, personId },
      );
      await reloadAfterRemoval({ log, reloadStream: deps.reloadStream }, targetNodeId);
      return c.json(result);
    }),
  );
}
