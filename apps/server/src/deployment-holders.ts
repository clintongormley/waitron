import {
  readDeploymentAxes,
  type Database,
  type DeploymentMode,
  type SingletonRole,
} from "@waitron/db";

/**
 * This node's two role axes (`node_roles`), each in a cell read live per request / per pass so a
 * promotion needs no restart.
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
 * Re-reads this node's two axes into the holders. Both come from a SINGLE read of one row, so the
 * holders can never hold a torn `(mode, singleton_role)` pair that `node_roles_role_valid_ck` forbids.
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
