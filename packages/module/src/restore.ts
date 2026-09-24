import type { Transaction } from "@waitron/db";
import type { ProvisionedNode } from "./provisioning.js";

/**
 * `series`, when present, REPLACES the node's live invoice series; absent leaves them alone. At most
 * one module may return it, and an empty list is a module error — a node with no live standard series
 * cannot sell.
 */
export interface RestoreOutcome {
  /** One line for the operator's terminal. */
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/**
 * What a module does so a box about to TAKE a restored node's identity can trade as that node. Runs
 * inside the orchestrator's transaction, before the identity is written to disk; never runs for a
 * restore that keeps the box's own identity.
 */
export type RestoreHook = (tx: Transaction, node: ProvisionedNode) => Promise<RestoreOutcome>;
