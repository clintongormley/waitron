import type { Context, Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { verifyEnvelope, type HandoverRole, type HandoverState } from "@waitron/handover";
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
}

export interface PeerQueryBody {
  nonce: string;
  atMs: number;
  operationId?: string;
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
}

const STATUS = {
  "handover.peer_unknown": 403,
  "handover.request_invalid": 400,
} as const;

const QUERY_KEYS = new Set(["nonce", "atMs", "operationId"]);

function invalid(field: string): never {
  throw new AppError("handover.request_invalid", { field });
}

function parseQuery(body: unknown): PeerQueryBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) invalid("body");
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !QUERY_KEYS.has(key))) invalid("body");
  const { nonce, atMs, operationId } = fields;
  if (typeof nonce !== "string" || nonce.length < 16 || nonce.length > 64) invalid("nonce");
  if (typeof atMs !== "number" || !Number.isFinite(atMs)) invalid("atMs");
  if (operationId === undefined) return { nonce, atMs };
  if (typeof operationId !== "string" || operationId.length === 0 || operationId.length > 64)
    invalid("operationId");
  return { nonce, atMs, operationId };
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
    if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose") invalid("envelope");
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

  app.post("/api/node/peer-status", (c) =>
    run(c, log, async () => {
      const { query } = await verifiedPeerQuery(c, deps);
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
      };
      return c.json(await signAsThisBox(deps, "status", body as unknown as CanonicalValue), 200);
    }),
  );
}
