import type { Transaction } from "@waitron/db";
import type { ProvisionedNode } from "./provisioning.js";

/**
 * What a module hands back from its restore hook. `series`, when present, REPLACES the node's live
 * invoice series: the orchestrator retires every live series of the node and opens these at number 1
 * (`invoice_series` is core's table; the disjointness rule is the module's). Absent = leave the
 * series alone. At most one module may return it; an empty list is a module error — a node with no
 * live standard series cannot sell.
 */
export interface RestoreOutcome {
  /** One line for the operator's terminal. */
  readonly report: string;
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/**
 * A module's restore hook: what it does so a box that has just restored this node's backup and is
 * about to TAKE its identity can trade again as that node. Runs inside the orchestrator's tenant
 * transaction (origin-stamped with the node), after the database is restored and migrated and before
 * the identity is written to disk. Never runs for a restore that keeps the box's own identity.
 */
export type RestoreHook = (tx: Transaction, node: ProvisionedNode) => Promise<RestoreOutcome>;
