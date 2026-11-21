import type { Hono } from "hono";
import { readNodeMembership, withTransaction } from "@waitron/db";
import { refuseRequest, verifyEnvelope } from "@waitron/handover";
import { servingPrimaryNodeId } from "@waitron/membership";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { createEnrolRateLimiter, type EnrolRateLimiter } from "./enrol-rate-limit.js";
import { peerKeyOf } from "./handover-signing.js";
import { selfEnrolNodeAgent } from "./join-requests.js";
import type { Logger } from "./logger.js";
import { peerBodyLimit } from "./peer-route-limits.js";
import type { PeerStatusApiDeps } from "./peer-status-api.js";
import "./errors.js";

export const PRINT_AGENT_ENROL_PATH = "/api/node/print-agent";

/** The body of the `agent-enrol` envelope a box signs for its own print agent. */
export interface AgentEnrolBody {
  name: string;
  /** The main box it is addressed to, so a request for one box is refused by another. */
  toNodeId: string;
}

/** The 201 answer: the agent's token, `<agentId>.<secret>`. */
export interface AgentEnrolAnswer {
  token: string;
}

export interface PrintAgentEnrolApiDeps extends Pick<
  PeerStatusApiDeps,
  "db" | "node" | "ring" | "nodeId"
> {
  /** Boot-captured, as for `enrol-self`: false on a mirror or fenced box. */
  isPrimary: boolean;
  enrolRateLimiter?: EnrolRateLimiter;
}

const STATUS = {
  "handover.request_invalid": 400,
  "handover.peer_unknown": 401,
  "node.enrol_unavailable": 409,
  "device.join_revoked": 403,
  "device.join_rate_limited": 429,
} as const;

const BODY_KEYS = ["name", "toNodeId"];

/**
 * `POST /api/node/print-agent` — another box asks the serving main box for a token for the print
 * agent running on it, in an envelope signed under a key `peerKeyOf` trusts for it. The agent's row
 * is the signer's, so each box keeps at most one; a repeat gives that row a new token. Only signed
 * requests count against the rate limit, so unsigned traffic cannot hold a box's agent off.
 */
export function mountPrintAgentEnrolApi(
  app: Hono,
  deps: PrintAgentEnrolApiDeps,
  log: Logger,
): void {
  const run = createErrorBoundary(STATUS, "node.failed");
  const limiter = deps.enrolRateLimiter ?? createEnrolRateLimiter();

  app.use(PRINT_AGENT_ENROL_PATH, peerBodyLimit(65536));
  app.post(PRINT_AGENT_ENROL_PATH, (c) =>
    run(c, log, async () => {
      if (!deps.isPrimary) throw new AppError("node.enrol_unavailable", {});
      const raw = await readRawJsonBody<unknown>(c);
      const held = await readNodeMembership(deps.db);
      const keyOf = await peerKeyOf(deps, held);
      // This box's own agent enrols over loopback (`node-enrol-api.ts`), never here.
      const verdict = verifyEnvelope<unknown>(raw, "agent-enrol", (id) =>
        id === deps.nodeId ? undefined : keyOf(id),
      );
      if (!verdict.valid) {
        if (verdict.reason === "malformed" || verdict.reason === "wrong_purpose")
          refuseRequest("envelope");
        throw new AppError("handover.peer_unknown", {});
      }
      limiter.check();
      const body = verdict.body;
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).sort().join() !== BODY_KEYS.join()
      )
        refuseRequest("body");
      const { name, toNodeId } = body as Record<string, unknown>;
      if (typeof name !== "string") refuseRequest("name");
      if (toNodeId !== deps.nodeId) refuseRequest("toNodeId");
      if (held === null || servingPrimaryNodeId(held) !== deps.nodeId)
        throw new AppError("node.enrol_unavailable", {});
      const { token } = await withTransaction(deps.db, (tx) =>
        selfEnrolNodeAgent(tx, { nodeId: verdict.signerNodeId, name }),
      );
      const answer: AgentEnrolAnswer = { token };
      return c.json(answer, 201);
    }),
  );
}
