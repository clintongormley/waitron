import { AppError } from "@waitron/shared";
import type {
  Endorsement,
  MembershipDocumentBody,
  MembershipNode,
  SignedMembershipDocument,
} from "./types.js";
import { MAX_NODES, MAX_REVOKED, signDocumentBody } from "./verify.js";
import "./errors.js";

/**
 * Build and sign the next membership document; persisting it is the caller's job. `minTerm` raises
 * the term to at least that value. `revoked` defaults to the held chart's, so a caller that does
 * not know the list exists keeps it — but only as current as that held chart: minted from a held
 * chart older than a clearing, the next chart drops the clearing, as it already drops an eviction.
 */
export function buildNextMembershipDocument(args: {
  heldDocument: SignedMembershipDocument | null;
  nodes: readonly MembershipNode[];
  signerNodeId: string;
  signerPrivateKey: string;
  endorsements?: readonly Endorsement[];
  minTerm?: number;
  revoked?: readonly string[];
}): SignedMembershipDocument {
  const revoked = args.revoked ?? args.heldDocument?.body.revoked ?? [];
  refuseUnverifiableChart(args.nodes, revoked);
  const term = Math.max(
    args.heldDocument === null ? 0 : args.heldDocument.body.term + 1,
    args.minTerm ?? 0,
  );
  const body: MembershipDocumentBody =
    revoked.length === 0 ? { term, nodes: args.nodes } : { term, nodes: args.nodes, revoked };
  return {
    body,
    signerNodeId: args.signerNodeId,
    signature: signDocumentBody(body, args.signerPrivateKey),
    endorsements: args.endorsements ?? [],
  };
}

function refuseUnverifiableChart(
  nodes: readonly MembershipNode[],
  revoked: readonly string[],
): void {
  if (nodes.length > MAX_NODES) {
    throw new AppError("membership.chart_too_large", {
      list: "nodes",
      count: nodes.length,
      limit: MAX_NODES,
    });
  }
  if (revoked.length > MAX_REVOKED) {
    throw new AppError("membership.chart_too_large", {
      list: "revoked",
      count: revoked.length,
      limit: MAX_REVOKED,
    });
  }
  const seen = new Set<string>();
  for (const id of revoked) {
    if (seen.has(id)) throw new AppError("membership.revoked_duplicate", { nodeId: id });
    seen.add(id);
  }
  const listed = nodes.find((n) => seen.has(n.nodeId));
  if (listed !== undefined) {
    throw new AppError("membership.revoked_node_listed", { nodeId: listed.nodeId });
  }
}
