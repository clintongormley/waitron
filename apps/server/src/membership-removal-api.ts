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
import { orderReset } from "./reset-order.js";
import type { Logger } from "./logger.js";
import { isRemoteStaffRequest } from "./request-from-box.js";
import type { ListedJoinRequest } from "./box-join-requests.js";
import type { OldBoxComparison } from "./old-box-holdings.js";

export interface MembershipRemovalApiDeps {
  readSpare?: () => Promise<import("./spare-follow.js").SpareFollowView | null>;
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  reloadStream: () => Promise<void>;
  /** Backup freshness, for whether a replaced box's returned records are on a backup. */
  readBackup?: () => Promise<import("./backup-status.js").BackupStatus>;
  /** The boxes asking to join that the Servers page lists. */
  listJoinRequests?: () => ListedJoinRequest[];
  /** The old main boxes' summaries the reset-order route keeps, for `oldBoxHoldsMore`. */
  oldBoxes?: OldBoxComparison;
}

export const MEMBERSHIP_API_STATUS: Record<string, ContentfulStatusCode> = {
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
  "handover.reset_loss_unaccepted": 409,
  "handover.reset_not_previous_main": 409,
  "membership.node_not_replaced": 409,
  "management.request_invalid": 400,
  ...CHART_MINT_REFUSALS,
  "membership.write_contended": 503,
};

export function mountMembershipRemovalApi(
  app: Hono,
  deps: MembershipRemovalApiDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(MEMBERSHIP_API_STATUS, "membership.removal_failed");
  const runClear = createErrorBoundary(MEMBERSHIP_API_STATUS, "membership.clearance_failed");
  const runAbandon = createErrorBoundary(MEMBERSHIP_API_STATUS, "handover.return_abandon_failed");
  const runReset = createErrorBoundary(MEMBERSHIP_API_STATUS, "handover.reset_order_failed");

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
      const listing = await listServers(
        deps.db,
        deps.node,
        deps.nodeId,
        deps.readBackup,
        deps.oldBoxes,
      );
      return c.json({
        term: listing.term,
        nodes: listing.nodes,
        ...(deps.readSpare === undefined ? {} : { spare: await deps.readSpare() }),
        // A join is approved only on this box's own page (`box-join-api.ts`), never through Cloud.
        ...(deps.listJoinRequests === undefined || isRemoteStaffRequest(c)
          ? {}
          : { joinRequests: deps.listJoinRequests() }),
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

  app.post("/management-api/servers/:nodeId/reset", (c) =>
    runReset(c, log, async () => {
      const personId = await authorize(requireManagementSession(c), true);
      const body = await readJsonBody<{ acceptLoss?: unknown }>(c);
      if (typeof body.acceptLoss !== "boolean") {
        throw new AppError("management.request_invalid", { field: "acceptLoss" });
      }
      // A loss order ships with its download of unreturned records (A1558 PR 10b).
      if (body.acceptLoss) {
        throw new AppError("management.request_invalid", { field: "acceptLoss" });
      }
      return c.json(
        await orderReset(deps, {
          targetNodeId: c.req.param("nodeId"),
          personId,
          acceptLoss: body.acceptLoss,
        }),
      );
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
