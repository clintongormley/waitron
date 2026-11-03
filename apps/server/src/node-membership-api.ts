import type { Hono } from "hono";
import {
  persistNodeMembershipIfNewer,
  readMembershipTrustSet,
  readNodeMembership,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  acceptMembershipDocument,
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { readHandoverRestriction } from "@waitron/node-db";
import { createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
import type { StepDownRequest, StepDownResult } from "./handover-stepdown.js";
import type { Logger } from "./logger.js";

export interface NodeMembershipApiDeps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  /** The full start's stepdown; a start without one only holds the chart. */
  stepDown?: (request: StepDownRequest) => Promise<StepDownResult>;
  /** Whether this box is selling now: not a mirror, and not fenced when it started. */
  selling?: () => boolean;
}

function documentOf(raw: unknown): SignedMembershipDocument | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  return ((raw as { document?: unknown }).document ?? null) as SignedMembershipDocument | null;
}

/**
 * `POST /api/node/membership` — a box is handed a signed chart. It keeps the chart when it verifies
 * against the stored keys and is strictly newer than the one held; when that chart fences a selling
 * box that holds no restriction, the box steps down as `superseded` before it sells again. A
 * refused chart answers only `{ accepted: false }`, so the caller learns nothing it did not send.
 */
export function mountNodeMembershipApi(app: Hono, deps: NodeMembershipApiDeps, log: Logger): void {
  const run = createErrorBoundary({}, "node-membership.failed");

  app.post("/api/node/membership", (c) =>
    run(c, log, async () => {
      const incoming = documentOf(await readRawJsonBody<unknown>(c));
      if (incoming === null) return c.json({ accepted: false }, 200);
      const [trustSet, held] = await Promise.all([
        readMembershipTrustSet(deps.db),
        readNodeMembership(deps.db),
      ]);
      // Judged against the chart held before it, as boot does: a retirement chart is signed by
      // the node it evicts.
      const verdict = acceptMembershipDocument(incoming, held?.body.term ?? null, trustSet, held);
      if (!verdict.accepted) return c.json({ accepted: false }, 200);
      if (!(await persistNodeMembershipIfNewer(deps.db, incoming)))
        return c.json({ accepted: false }, 200);
      if (
        deps.stepDown === undefined ||
        deps.selling?.() !== true ||
        !isFencedStanding(standingOf(incoming, deps.nodeId))
      )
        return c.json({ accepted: true }, 200);
      // A second restriction write that differs is refused, so a box already restricted keeps
      // the one it has.
      if ((await readHandoverRestriction(deps.node, deps.nodeId)) !== null)
        return c.json({ accepted: true }, 200);
      const successorNodeId = servingPrimaryNodeId(incoming);
      if (successorNodeId === undefined) {
        log("warn", "membership.fenced_without_successor", { term: incoming.body.term });
        return c.json({ accepted: true }, 200);
      }
      // venue.db's chart is saved above, before stepDown writes node.db's restriction.
      await deps.stepDown({
        kind: "superseded",
        successorNodeId,
        membershipTerm: incoming.body.term,
        self: c,
      });
      return c.json({ accepted: true }, 200);
    }),
  );
}
