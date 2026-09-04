import type { NodeStanding, SignedMembershipDocument } from "./types.js";

/**
 * This node's standing in a held document, or `undefined` when the node is absent from the chart
 * (design §3). A pure lookup over `document.body.nodes` — no verification: the held document was
 * verified when it was adopted (membership-adopt.ts) or self-signed at promotion, so reading it back
 * for a role decision is reading our own authoritative state, exactly as the deployment axes are.
 */
export function standingOf(
  document: SignedMembershipDocument,
  nodeId: string,
): NodeStanding | undefined {
  return document.body.nodes.find((n) => n.nodeId === nodeId)?.standing;
}

/**
 * Whether a standing fences a node OUT OF SERVING (design §3): `sell-only` (fenced, still a
 * replication source until its tail drains) and `evicted` (drained, retired) are fenced;
 * `serving-primary` and `serving-secondary` both serve (a serving-secondary sells, holds no
 * singletons). An `undefined` standing — a node ABSENT from the chart — is NOT fenced: promotion's
 * `nextStandings` preserves every node and demotes the outgoing primary to `sell-only` rather than
 * dropping it (standings.ts), so a node that was ever in the chart stays in it; fencing an unnamed
 * node on an incomplete chart would be the wrong direction. R1 recognises `evicted` defensively
 * though nothing produces it yet — eviction is a later round.
 */
export function isFencedStanding(standing: NodeStanding | undefined): boolean {
  return standing === "sell-only" || standing === "evicted";
}
