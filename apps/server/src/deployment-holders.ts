import {
  readDeploymentAxes,
  type Database,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";

/**
 * This node's two orthogonal role axes (`node_roles`) the running process gates on, each in a
 * one-field cell read live per request / per pass so a promotion is a genuine flag-flip with no
 * restart (promotion runbook design §3b). `mode` fronts the read-only gate + ambient viewer; `singletonRole` gates the fiscal drain/reconcile
 * pass (see `singletonPass`). Held together so the promote action refreshes both in one call.
 */
export interface DeploymentHolders {
  readonly mode: { current: DeploymentMode };
  readonly singletonRole: { current: SingletonRole };
}

/** Builds the holders from values already read at boot — no I/O. */
export function createDeploymentHolders(
  mode: DeploymentMode,
  singletonRole: SingletonRole,
): DeploymentHolders {
  return { mode: { current: mode }, singletonRole: { current: singletonRole } };
}

/**
 * Re-reads this node's two axes from the database into the holders. The promote action calls this
 * AFTER its write so the running gates and the fiscal pass observe the new state on their next tick
 * (promotion runbook design §3b).
 *
 * Both axes come from a SINGLE `readDeploymentAxes` read of one row, so the holders can never be
 * assigned a torn `(mode, singleton_role)` pair — e.g. `(mirror, primary)` — which
 * `node_roles_role_valid_ck` forbids from ever existing in a committed row.
 */
export async function refreshDeploymentHolders(
  db: Database,
  nodeId: string,
  holders: DeploymentHolders,
): Promise<void> {
  const axes = await readDeploymentAxes(db, nodeId);
  holders.mode.current = axes.mode;
  holders.singletonRole.current = axes.singletonRole;
}
