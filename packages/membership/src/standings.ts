import type { MembershipNode } from "./types.js";

/**
 * The new org chart after a local-secondary promotion (design §6 R1): this node becomes serving-primary,
 * whichever node was serving-primary becomes sell-only (still a replication source until drained, so it
 * is demoted rather than evicted), and every other node is left exactly as it was (contactUrl preserved).
 * If this node is not yet listed, it is appended as serving-primary with an empty contactUrl — so a
 * promote against a held chart that omits the promoting node still names it correctly.
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
