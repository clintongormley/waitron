import type { Hono } from "hono";
import { readNodeMembership } from "@waitron/db";
import type { HandoverRole, HandoverState, SignedHandoverEnvelope } from "@waitron/handover";
import type { CanonicalValue } from "@waitron/membership";
import { readHandoverOperation, type HandoverOperation } from "@waitron/node-db";
import { createErrorBoundary } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

export interface HandoverStatusBody {
  operationId: string;
  role: HandoverRole;
  scenario: "controlled" | "emergency";
  state: HandoverState;
  sourceNodeId: string;
  destinationNodeId: string;
  waitingReason: string | null;
  handoverPage?: string;
}

const STATUS = {
  "handover.request_invalid": 400,
  "handover.operation_unknown": 404,
} as const;

const OPERATION_ID_MAX_LENGTH = 64;

/** The address of an operation's page on the box at `contactUrl`. */
export function handoverPageAt(contactUrl: string, operationId: string): string {
  return `${contactUrl.replace(/\/+$/, "")}/handover/${operationId}`;
}

export async function handoverPageOf(
  deps: PeerStatusApiDeps,
  operation: HandoverOperation,
): Promise<string | undefined> {
  // `abandoned` is not past `prepared`: a source reaches it only from there, without stepping down.
  if (
    operation.role !== "source" ||
    operation.state === "prepared" ||
    operation.state === "abandoned"
  ) {
    return undefined;
  }
  const chart = await readNodeMembership(deps.db);
  const contactUrl = chart?.body.nodes.find(
    (entry) => entry.nodeId === operation.destinationNodeId,
  )?.contactUrl;
  if (contactUrl === undefined || contactUrl === "") return undefined;
  return handoverPageAt(contactUrl, operation.operationId);
}

/** `operation`'s state as this box signs it: no chart and no nonce, so any caller may read it. */
export async function signedHandoverStatus(
  deps: PeerStatusApiDeps,
  operation: HandoverOperation,
): Promise<SignedHandoverEnvelope<CanonicalValue>> {
  const handoverPage = await handoverPageOf(deps, operation);
  const body: HandoverStatusBody = {
    operationId: operation.operationId,
    role: operation.role,
    scenario: operation.scenario,
    state: operation.state,
    sourceNodeId: operation.sourceNodeId,
    destinationNodeId: operation.destinationNodeId,
    waitingReason: operation.waitingReason,
    ...(handoverPage === undefined ? {} : { handoverPage }),
  };
  return signAsThisBox(deps, "status", body as unknown as CanonicalValue);
}

/** `GET /api/node/handover/:operationId` — one operation's state, for either end, with no sign-in. */
export function mountHandoverStatusApi(app: Hono, deps: PeerStatusApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "handover-status.failed");

  app.get("/api/node/handover/:operationId", (c) =>
    run(c, log, async () => {
      const operationId = c.req.param("operationId");
      // A refusal's params are logged, and this route takes any caller's text.
      if (operationId.length > OPERATION_ID_MAX_LENGTH) {
        throw new AppError("handover.request_invalid", { field: "operationId" });
      }
      const operation = await readHandoverOperation(deps.node, deps.nodeId, operationId);
      if (operation === null) throw new AppError("handover.operation_unknown", { operationId });
      return c.json(await signedHandoverStatus(deps, operation), 200);
    }),
  );
}
