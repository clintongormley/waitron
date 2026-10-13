import type { Transaction } from "@waitron/db";
import type { LocationId, NodeId } from "@waitron/shared";
import type { ModuleOperationInput } from "./operation-input.js";

/** These identities come from rows the host inserted or read. */
export interface ProvisionedNode {
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
  run(tx: Transaction, node: ProvisionedNode, operation?: ModuleOperationInput): Promise<string>;
  /** A filing seed may own series creation. Resolve its active references after setup and on
   * retries, without activating again; reject requested bases that differ from the allocation. */
  readonly series?: {
    resolve(
      tx: Transaction,
      node: ProvisionedNode,
      bases: readonly { readonly code: string; readonly purpose: string }[],
    ): Promise<readonly { readonly id: string; readonly code: string; readonly purpose: string }[]>;
  };
}

/** One module's line in a provisioning run's summary: the report its `NodeSeed.run` returned. */
export interface SeedReport {
  readonly module: string;
  readonly report: string;
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
  reserve(
    tx: Transaction,
    primary: ProvisionedNode,
    standby?: ProvisionedNode,
    operation?: ModuleOperationInput,
  ): Promise<StandbyReservation>;
  /** Mirror side, inside the adopt transaction, after the standby's own node row exists. `state` is
   * wire input the module validates before writing anything. */
  establish(
    tx: Transaction,
    standby: ProvisionedNode,
    state: unknown,
    operation?: ModuleOperationInput,
  ): Promise<void>;
  /** Runs in the role-change transaction, before the host checks the trading series. */
  activate?(
    tx: Transaction,
    standby: ProvisionedNode,
    operation?: ModuleOperationInput,
  ): Promise<void>;
}

export interface ModuleProvisioning {
  readonly seed?: NodeSeed;
  readonly standby?: StandbyProvisioning;
}
