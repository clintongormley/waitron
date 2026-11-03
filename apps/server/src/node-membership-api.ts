import type { Hono } from "hono";
import {
  persistNodeMembershipIfNewerTx,
  readMembershipTrustSetTx,
  readNodeMembership,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  acceptMembershipDocument,
  isFencedStanding,
  servingPrimaryNodeId,
  standingOf,
  type AcceptResult,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { readHandoverRestriction } from "@waitron/node-db";
import { codeOf, createErrorBoundary, readRawJsonBody } from "@waitron/server-kit";
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
 * Verifies `incoming` against the chart and keys held now and saves it when it is strictly newer,
 * in one venue transaction, so no chart or key can change between the verdict and the save.
 * Answers the verdict and the chart held when that transaction ends.
 */
export function saveVerifiedMembership(
  db: Database,
  incoming: SignedMembershipDocument,
): Promise<{ verdict: AcceptResult; held: SignedMembershipDocument | null }> {
  return withTransaction(db, async (tx) => {
    const held = await readNodeMembership(tx);
    const trustSet = await readMembershipTrustSetTx(tx);
    // Judged against the chart held before it: a retirement chart is signed by the node it evicts.
    const verdict = acceptMembershipDocument(incoming, held?.body.term ?? null, trustSet, held);
    if (!verdict.accepted) return { verdict, held };
    if (await persistNodeMembershipIfNewerTx(tx, incoming)) return { verdict, held: incoming };
    return { verdict: { accepted: false, reason: "not_newer" }, held };
  });
}

/**
 * `POST /api/node/membership` — a box is handed a signed chart. It keeps the chart when it verifies
 * against the stored keys and is strictly newer than the one held. When the chart it then holds
 * fences a selling box that holds no restriction, the box steps down as `superseded` before it
 * sells again. A refused chart answers only `{ accepted: false }`, so the caller learns nothing it
 * did not send.
 */
export function mountNodeMembershipApi(app: Hono, deps: NodeMembershipApiDeps, log: Logger): void {
  const run = createErrorBoundary({}, "node-membership.failed");

  app.post("/api/node/membership", (c) =>
    run(c, log, async () => {
      const incoming = documentOf(await readRawJsonBody<unknown>(c));
      if (incoming === null) return c.json({ accepted: false }, 200);
      const { verdict, held: now } = await saveVerifiedMembership(deps.db, incoming);
      // A chart that verifies but is not newer may be the one already held, sent again because
      // the stepdown it should have caused failed.
      if (!verdict.accepted && verdict.reason !== "not_newer")
        return c.json({ accepted: false }, 200);
      const { accepted } = verdict;
      // Decided from the chart held now, saved in venue.db before stepDown writes node.db, so a
      // re-send repairs a stepdown that failed.
      if (
        now === null ||
        deps.stepDown === undefined ||
        deps.selling?.() !== true ||
        !isFencedStanding(standingOf(now, deps.nodeId)) ||
        // A second restriction write that differs is refused, so a box already restricted keeps
        // the one it has.
        (await readHandoverRestriction(deps.node, deps.nodeId)) !== null
      )
        return c.json({ accepted }, 200);
      try {
        await deps.stepDown({
          kind: "superseded",
          successorNodeId: servingPrimaryNodeId(now) ?? null,
          membershipTerm: now.body.term,
          self: c,
        });
      } catch (error) {
        // Another request's stepdown for a different chart got there first; this box is stopping.
        if (codeOf(error) !== "handover.restriction_conflict") throw error;
      }
      return c.json({ accepted }, 200);
    }),
  );
}
