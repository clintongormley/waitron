import "@waitron/shared";
import type { VerifyFailure } from "./types.js";

declare module "@waitron/shared" {
  interface ErrorParams {
    // Signing with our own malformed key; verification fails closed instead of throwing.
    "membership.key_invalid": { operation: "sign" };
    "membership.chart_too_large": { list: "nodes"; count: number; limit: number };
    "membership.cleared_list_full": { count: number; limit: number };
    "membership.revoked_node_listed": { nodeId: string };
    "membership.revoked_duplicate": { nodeId: string };
    /**
     * The chart this box holds is too broken to read (`malformed`), or vouched for by no key it
     * stores itself (its own, or the main box's it pinned). The first comes only from a fault; the
     * second also from a Cloud peer, or (with three or more boxes) a main box that changed twice
     * since this box joined, which the backlog records. Screens show the generic text.
     */
    "membership.held_untrusted": { reason: VerifyFailure };
  }
}
