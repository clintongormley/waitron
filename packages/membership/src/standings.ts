import type { MembershipNode } from "./types.js";

/**
 * The outgoing primary is demoted, never evicted: eviction is a node's own act (`retireSelf`).
 * A promoting node missing from the chart is appended with an empty contactUrl, which
 * `routableServers` drops, so no till is told to dial it. The append is only a fallback, for a
 * promoting node whose own held chart omits it or is empty.
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

export function evictNode(current: readonly MembershipNode[], nodeId: string): MembershipNode[] {
  return current.map((n): MembershipNode =>
    n.nodeId === nodeId ? { ...n, standing: "evicted" } : n,
  );
}

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
