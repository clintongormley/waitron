import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Signing with our own malformed key; verification fails closed instead of throwing.
    "membership.key_invalid": { operation: "sign" };
    // Minting refuses a list over its cap (MAX_NODES, MAX_REVOKED), a duplicated revoked id and an
    // id in both lists. `list` names which list is full.
    "membership.chart_too_large": { list: "nodes" | "revoked"; count: number; limit: number };
    "membership.revoked_node_listed": { nodeId: string };
    "membership.revoked_duplicate": { nodeId: string };
  }
}
