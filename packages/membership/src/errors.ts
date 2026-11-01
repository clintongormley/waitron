import "@waitron/shared";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Signing with our own malformed key; verification fails closed instead of throwing.
    "membership.key_invalid": { operation: "sign" };
    "membership.chart_too_large": { list: "nodes"; count: number; limit: number };
    "membership.cleared_list_full": { count: number; limit: number };
    "membership.revoked_node_listed": { nodeId: string };
    "membership.revoked_duplicate": { nodeId: string };
  }
}
