import type { MembershipNode } from "./types.js";

/**
 * The new org chart after a local-secondary promotion (design §6 R1): this node becomes serving-primary,
 * whichever node was serving-primary becomes sell-only (still a replication source until drained, so it
 * is demoted rather than evicted), and every other node is left exactly as it was (contactUrl preserved).
 * If this node is not yet listed, it is appended as serving-primary with an empty contactUrl. That
 * entry is ADDRESS-LESS by design and therefore unroutable — `routableServers` drops a node with an
 * empty contactUrl, so no till would be told to dial it — which is sound only because a node reaches
 * the chart before it can promote: adopt appends the joining node with its advertised origin
 * (`withMember`, till-reroute §3.3). The append here is the fallback for a promote against a chart
 * that somehow omits the promoting node: it names the node so the term is well-formed, and the node
 * publishes its address by re-seeding.
 */
export function nextStandings(
  current: readonly MembershipNode[],
  selfNodeId: string,
): MembershipNode[] {
  const next = current.map((n): MembershipNode => {
    if (n.nodeId === selfNodeId) return { ...n, standing: "serving-primary" };
    if (n.standing === "serving-primary") return { ...n, standing: "sell-only" };
    return n;
  });
  if (!next.some((n) => n.nodeId === selfNodeId)) {
    next.push({ nodeId: selfNodeId, contactUrl: "", standing: "serving-primary" });
  }
  return next;
}

/**
 * The new org chart after a node is decommissioned (design §3, §6): the node whose nodeId is named is
 * marked `evicted`, and every other node is left exactly as it was (contactUrl preserved) — the same
 * "preserve everyone else" discipline `nextStandings` follows. This is the eviction producer for the
 * retire/evict decommission path, minting the `sell-only → evicted` transition once a fenced node has
 * fully drained its replication tail. Unlike `nextStandings` it NEVER appends a missing node: you
 * cannot evict a node that is not already a member, so a nodeId not in the list yields an unchanged
 * copy. Returns a new array and never mutates the input.
 */
export function evictNode(current: readonly MembershipNode[], nodeId: string): MembershipNode[] {
  return current.map((n): MembershipNode =>
    n.nodeId === nodeId ? { ...n, standing: "evicted" } : n,
  );
}

/**
 * The org chart after a node JOINS (adopt, till-reroute design §3.3): the node is appended as
 * `serving-secondary` — the standing for "a member that is not primary"; under warm standby it still
 * sells nothing, because a till obeys `GET /api/node`'s `acceptingSales`, never the standing — with its
 * advertised `contactUrl`, the address tills route on. A node already listed keeps its standing and only
 * has its `contactUrl` refreshed (a re-adopt after a wipe). Returns a new array; never mutates the input.
 */
export function withMember(
  current: readonly MembershipNode[],
  nodeId: string,
  contactUrl: string,
): MembershipNode[] {
  if (current.some((n) => n.nodeId === nodeId)) {
    return current.map((n): MembershipNode => (n.nodeId === nodeId ? { ...n, contactUrl } : n));
  }
  return [...current, { nodeId, contactUrl, standing: "serving-secondary" }];
}
