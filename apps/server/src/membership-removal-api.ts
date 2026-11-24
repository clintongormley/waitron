import "./errors.js";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  readDeploymentEnvironment,
  readNodeMembership,
  withTransaction,
  withVenueAndNodeTransaction,
  type Database,
  type DeploymentEnvironment,
  type NodeDatabase,
  type NodeTransaction,
} from "@waitron/db";
import { authorizeManager, requireFreshManagementSignIn } from "@waitron/identity";
import type { KeyRing } from "@waitron/credentials";
import { readOpenHandoverOperation, readPairLink } from "@waitron/node-db";
import { AppError, type ErrorParams } from "@waitron/shared";
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
import { joinedAnotherBox } from "./box-tls-install.js";
import { failedAtFolderSync } from "./fs-atomic.js";
import {
  readReplacedResetMarker,
  removeReplacedResetMarker,
  writeReplacedResetMarker,
} from "./replaced-reset.js";
import { outgoingOf, restartAfterResponse } from "./restart-after-response.js";

interface SelfReset {
  stateDir: string;
  environment: DeploymentEnvironment;
  setupUrl: string;
  isReadOnly: () => boolean;
  restart: () => void | Promise<void>;
}

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
  selfReset?: SelfReset;
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
  "membership.self_reset_unavailable": 409,
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

async function selfResetStatus(
  reset: SelfReset,
  db: Database,
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
  remote: boolean,
): Promise<"available" | ErrorParams["membership.self_reset_unavailable"]["reason"]> {
  if (
    reset.environment !== "preproduction" ||
    (await readDeploymentEnvironment(db)) !== "preproduction"
  )
    return "environment";
  if (remote) return "local_address_required";
  if (await joinedAnotherBox(reset.stateDir)) return "joined_another_box";
  const chart = await readNodeMembership(db);
  if (
    reset.isReadOnly() ||
    (chart !== null &&
      (!chart.body.nodes.some(
        (box) => box.nodeId === nodeId && box.standing === "serving-primary",
      ) ||
        chart.body.nodes.some((box) => box.nodeId !== nodeId && box.standing !== "evicted"))) ||
    (await readPairLink(node, nodeId)) !== null ||
    (await readOpenHandoverOperation(node, nodeId)) !== null
  )
    return "remove_other_boxes";
  if ((await readReplacedResetMarker(reset.stateDir)) !== null) return "reset_pending";
  return "available";
}

export function mountMembershipRemovalApi(
  app: Hono,
  deps: MembershipRemovalApiDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(MEMBERSHIP_API_STATUS, "membership.removal_failed");
  const runClear = createErrorBoundary(MEMBERSHIP_API_STATUS, "membership.clearance_failed");
  const runAbandon = createErrorBoundary(MEMBERSHIP_API_STATUS, "handover.return_abandon_failed");
  const runReset = createErrorBoundary(MEMBERSHIP_API_STATUS, "handover.reset_order_failed");
  const runSelfReset = createErrorBoundary(MEMBERSHIP_API_STATUS, "membership.self_reset_failed");
  const selfReset = deps.selfReset;

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
      const listing = await listServers(deps.db, deps.node, deps.nodeId, deps.readBackup);
      const remote = isRemoteStaffRequest(c);
      const resetThisBox =
        selfReset && (await selfResetStatus(selfReset, deps.db, deps.node, deps.nodeId, remote));
      return c.json({
        term: listing.term,
        nodes: listing.nodes,
        ...(resetThisBox === "environment" || resetThisBox === undefined ? {} : { resetThisBox }),
        ...(deps.readSpare === undefined ? {} : { spare: await deps.readSpare() }),
        // A join is approved only on this box's own page (`box-join-api.ts`), never through Cloud.
        ...(deps.listJoinRequests === undefined || remote
          ? {}
          : { joinRequests: deps.listJoinRequests() }),
      });
    }),
  );

  if (selfReset !== undefined)
    app.post("/management-api/servers/reset-this-box", (c) =>
      runSelfReset(c, log, async () => {
        await authorize(requireManagementSession(c), true);
        const { confirmation } = await readJsonBody<{ confirmation?: unknown }>(c);
        if (confirmation !== "reset")
          throw new AppError("management.request_invalid", { field: "confirmation" });
        let staged = false;
        try {
          await withVenueAndNodeTransaction(deps.db, deps.node, async (_tx, nodeTx) => {
            const reason = await selfResetStatus(
              selfReset,
              deps.db,
              nodeTx,
              deps.nodeId,
              isRemoteStaffRequest(c),
            );
            if (reason !== "available")
              throw new AppError("membership.self_reset_unavailable", { reason });
            await writeReplacedResetMarker(selfReset.stateDir, {
              phase: "wiping",
              setAside: false,
            });
            staged = true;
          });
        } catch (error) {
          if (staged || failedAtFolderSync(error))
            await removeReplacedResetMarker(selfReset.stateDir);
          throw error;
        }
        restartAfterResponse(
          outgoingOf(c),
          async () => {
            try {
              await selfReset.restart();
            } catch (error) {
              await removeReplacedResetMarker(selfReset.stateDir);
              throw error;
            }
          },
          log,
        );
        return c.json({ setupUrl: selfReset.setupUrl }, 202);
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
