import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Signing with our own malformed key; verification fails closed instead of throwing.
    "membership.key_invalid": { operation: "sign" };
    // Minting refuses a chart every receiver's shape check would refuse.
    "membership.chart_too_large": { list: "nodes" | "revoked"; count: number; limit: number };
    "membership.revoked_node_listed": { nodeId: string };
    "membership.revoked_duplicate": { nodeId: string };
  }
}
