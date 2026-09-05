import type { Transaction } from "@waitron/db";
import type { LocationId, NodeId, TenantId } from "@waitron/shared";

/** The node a seed runs for. Built by the RUNNER from rows it inserted or read — never from operator
 * input; anything else a module needs (the tenant's tax id, its own product constants) it reads or
 * owns itself. */
export interface ProvisionedNode {
  readonly tenantId: TenantId;
  readonly locationId: LocationId;
  readonly nodeId: NodeId;
}

/** A per-node seed: what a module establishes for a freshly created (or reimaged) node. */
export interface NodeSeed {
  /** One line for the operator's plan summary. Names the effect, not the mechanism. */
  readonly summary: string;
  /** Runs INSIDE the caller's provisioning transaction, after the core rows exist. Returns a one-line
   * report of what it established. Re-running for an existing node is the module's call to define,
   * never an error here. */
  run(tx: Transaction, node: ProvisionedNode): Promise<string>;
}

export interface StandbyReservation {
  /** Module-owned, opaque to the carrier, JSON-serialisable (it rides the mirror bundle). */
  readonly state: unknown;
  /** The standby's invoice series, codes derived disjoint from the primary's by the module; the
   * carrier inserts them. */
  readonly series?: readonly { readonly code: string; readonly purpose: string }[];
}

/** Standby support: the primary reserves, the mirror establishes. Declared together — a module that
 * reserves state must know how to establish it. */
export interface StandbyProvisioning {
  /** Primary side, inside the bundle-minting transaction. */
  reserve(tx: Transaction, primary: ProvisionedNode): Promise<StandbyReservation>;
  /** Mirror side, inside the adopt transaction, after the standby's own node row exists. `state` is
   * wire input the module validates before writing anything. */
  establish(tx: Transaction, standby: ProvisionedNode, state: unknown): Promise<void>;
}

export interface ModuleProvisioning {
  readonly seed?: NodeSeed;
  readonly standby?: StandbyProvisioning;
}
