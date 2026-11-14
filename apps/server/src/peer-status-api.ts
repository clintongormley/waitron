import { peerBodyLimit } from "./peer-route-limits.js";
import type { Context, Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import {
  refuseRequest,
  isOperationId,
  verifyEnvelope,
  type HandoverRole,
  type HandoverState,
} from "@waitron/handover";
import type { CanonicalValue, SignedMembershipDocument } from "@waitron/membership";
import {
  readHandoverOperation,
  readHandoverRestriction,
  readOpenHandoverOperation,
  type HandoverOperation,
} from "@waitron/node-db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import type { Logger } from "./logger.js";
import "./errors.js";

export interface PeerStatusApiDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  /** Set only by the latch start: never inferred from a missing chart, which a lost venue.db also has. */
  joining?: boolean;
}

export type PeerQueryPurpose = "status" | "indicator" | "final-copy";

export interface PeerQueryBody {
  nonce: string;
  atMs: number;
  operationId?: string;
  /**
   * The route this query is for, present exactly when `operationId` is, so a query signed for one
   * route opens no other.
   */
  purpose?: PeerQueryPurpose;
}

export interface PeerOperationStatus {
  operationId: string;
  role: HandoverRole;
  scenario: "controlled" | "emergency";
  state: HandoverState;
  sourceNodeId: string;
  destinationNodeId: string;
}

export interface PeerStatusBody {
  heldMembership: SignedMembershipDocument | null;
  restriction: {
    kind: "handed-over" | "superseded";
    successorNodeId: string;
    operationId: string | null;
  } | null;
  openOperation: PeerOperationStatus | null;
  /** The operation the query names, open or closed. */
  requestedOperation: PeerOperationStatus | null;
  nonce: string;
  /** A spare still in its latch start: it cannot sell or file, so a start check sets it aside. */
  joining?: true;
}

const STATUS = {
  "handover.peer_unknown": 401,
  "handover.request_invalid": 400,
} as const;

const QUERY_KEYS = new Set(["nonce", "atMs", "operationId", "purpose"]);

function isPurpose(value: unknown): value is PeerQueryPurpose {
  return value === "status" || value === "indicator" || value === "final-copy";
}

function parseQuery(body: unknown): PeerQueryBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) refuseRequest("body");
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !QUERY_KEYS.has(key))) refuseRequest("body");
  const { nonce, atMs, operationId, purpose } = fields;
  if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 64) refuseRequest("nonce");
  if (typeof atMs !== "number" || !Number.isFinite(atMs)) refuseRequest("atMs");
  if (operationId === undefined) {
    if (purpose !== undefined) refuseRequest("purpose");
    return { nonce, atMs };
  }
  if (!isOperationId(operationId)) refuseRequest("operationId");
  if (!isPurpose(purpose)) refuseRequest("purpose");
  return { nonce, atMs, operationId, purpose };
}

/**
 * The request's `query` envelope, verified against the keys `peerKeyOf` vouches for, and its body.
 * A malformed envelope or body is `handover.request_invalid`; any other failed check is
 * `handover.peer_unknown`.
 */
export async function verifiedPeerQuery(
  c: Context,
  deps: PeerStatusApiDeps,
): Promise<{ signerNodeId: string; query: PeerQueryBody }> {
  const raw = await readRawJsonBody<unknown>(c);
  const verdict = verifyEnvelope<unknown>(raw, "query", await peerKeyOf(deps));
  if (!verdict.valid) {
    if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose")
      refuseRequest("envelope");
    throw new AppError("handover.peer_unknown", {});
  }
  return { signerNodeId: verdict.signerNodeId, query: parseQuery(verdict.body) };
}

function operationStatus(row: HandoverOperation | null): PeerOperationStatus | null {
  if (row === null) return null;
  return {
    operationId: row.operationId,
    role: row.role,
    scenario: row.scenario,
    state: row.state,
    sourceNodeId: row.sourceNodeId,
    destinationNodeId: row.destinationNodeId,
  };
}

/**
 * `POST /api/node/peer-status` — another box asks for this box's chart, restriction and handover
 * operation with a query signed by its own node key. The chart is answered only to a signer this
 * box's stored keys and held chart vouch for, never to an unsigned caller.
 */
export function mountPeerStatusApi(app: Hono, deps: PeerStatusApiDeps, log: Logger): void {
  const run = createErrorBoundary(STATUS, "peer-status.failed");

  app.use("/api/node/peer-status", peerBodyLimit(65536));
  app.post("/api/node/peer-status", (c) =>
    run(c, log, async () => {
      const { query } = await verifiedPeerQuery(c, deps);
      if (query.operationId !== undefined && query.purpose !== "status") refuseRequest("purpose");
      const held = await readNodeMembership(deps.db);
      const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
      const open = await readOpenHandoverOperation(deps.node, deps.nodeId);
      const requested =
        query.operationId === undefined
          ? null
          : await readHandoverOperation(deps.node, deps.nodeId, query.operationId);
      const body: PeerStatusBody = {
        heldMembership: held,
        restriction:
          restriction === null
            ? null
            : {
                kind: restriction.kind,
                successorNodeId: restriction.successorNodeId,
                operationId: restriction.operationId,
              },
        openOperation: operationStatus(open),
        requestedOperation: operationStatus(requested),
        nonce: query.nonce,
        ...(deps.joining === true ? { joining: true as const } : {}),
      };
      return c.json(await signAsThisBox(deps, "status", body as unknown as CanonicalValue), 200);
    }),
  );
}
