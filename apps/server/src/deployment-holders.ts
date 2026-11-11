import type { DeploymentMode, NodeDatabase, SingletonRole } from "@waitron/db";
import { readNodeMode } from "@waitron/node-db";

/**
 * This node's two role axes (node.db's `node_mode`), each in a cell read live per request / per
 * pass so a promotion needs no restart.
 */
export interface DeploymentHolders {
  readonly mode: { current: DeploymentMode };
  readonly singletonRole: { current: SingletonRole };
  onChange(listener: () => void): () => void;
}

const notifications = new WeakMap<DeploymentHolders, () => void>();

/** Builds the holders from values already read at boot — no I/O. */
export function createDeploymentHolders(
  mode: DeploymentMode,
  singletonRole: SingletonRole,
): DeploymentHolders {
  const listeners = new Set<() => void>();
  const holders: DeploymentHolders = {
    mode: { current: mode },
    singletonRole: { current: singletonRole },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  notifications.set(holders, () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* A notification cannot undo the role refresh. */
      }
    }
  });
  return holders;
}

/**
 * Re-reads this node's two axes into the holders. Both come from a SINGLE read of one row, so the
 * holders can never hold a torn `(mode, singleton_role)` pair that `node_mode_role_valid_ck`
 * forbids.
 */
export async function refreshDeploymentHolders(
  node: NodeDatabase,
  nodeId: string,
  holders: DeploymentHolders,
): Promise<void> {
  const axes = await readNodeMode(node, nodeId);
  const changed =
    holders.mode.current !== axes.mode || holders.singletonRole.current !== axes.singletonRole;
  holders.mode.current = axes.mode;
  holders.singletonRole.current = axes.singletonRole;
  if (changed) notifications.get(holders)?.();
}
