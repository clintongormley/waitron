import type { NodeStanding, SignedMembershipDocument } from "./types.js";

/**
 * No verification here; why, and which held rows nothing checked, is on `readNodeMembership` in
 * @waitron/db.
 */
export function standingOf(
  document: SignedMembershipDocument,
  nodeId: string,
): NodeStanding | undefined {
  if (document.body.revoked?.includes(nodeId) === true) return "evicted";
  return document.body.nodes.find((n) => n.nodeId === nodeId)?.standing;
}

/**
 * A node ABSENT from the chart — from both `nodes` and `revoked` — is NOT fenced: `nextStandings`
 * demotes rather than drops, clearing a node moves its id into `revoked`, and fencing an unnamed
 * node on an incomplete chart would be the wrong direction.
 */
export function isFencedStanding(
  standing: NodeStanding | undefined,
): standing is "sell-only" | "evicted" {
  return standing === "sell-only" || standing === "evicted";
}

/**
 * The ids a receiver shuts out when it verifies a peer's chart: every node its OWN held chart lists
 * `evicted`, and every revoked id. Read from the held chart, never an incoming one, because a
 * retirement chart is signed by the node it evicts.
 */
export function fencedOutNodeIds(held: SignedMembershipDocument | null): ReadonlySet<string> {
  if (held === null) return new Set();
  return new Set([
    ...held.body.nodes.filter((n) => n.standing === "evicted").map((n) => n.nodeId),
    ...(held.body.revoked ?? []),
  ]);
}

/** At most one node holds `serving-primary`, so the first match is it. */
export function servingPrimaryNodeId(document: SignedMembershipDocument): string | undefined {
  return document.body.nodes.find((n) => n.standing === "serving-primary")?.nodeId;
}

/** The standings a till may route to, best first. */
const ROUTABLE: readonly NodeStanding[] = ["serving-primary", "serving-secondary", "sell-only"];

export interface RoutableServer {
  readonly nodeId: string;
  readonly url: string;
  readonly standing: NodeStanding;
}

/** The venue's routable servers from a held chart: an address, a routable standing, primary first. */
export function routableServers(held: SignedMembershipDocument | null): RoutableServer[] {
  if (held === null) return [];
  return held.body.nodes
    .filter((n) => n.contactUrl !== "" && ROUTABLE.includes(n.standing))
    .sort((a, b) => ROUTABLE.indexOf(a.standing) - ROUTABLE.indexOf(b.standing))
    .map((n) => ({ nodeId: n.nodeId, url: n.contactUrl, standing: n.standing }));
}
