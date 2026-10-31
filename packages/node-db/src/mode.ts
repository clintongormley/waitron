import { eq } from "drizzle-orm";
import {
  now,
  requireStamp,
  tableExists,
  withNodeTransaction,
  type DeploymentMode,
  type NodeDatabase,
  type NodeTransaction,
  type SingletonRole,
} from "@waitron/db";
import type { VenueAndNodeHandles } from "./handles.js";
import { nodeMode } from "./schema/node-mode.js";

/**
 * Both of one node's axes from ONE read of its row, so the pair is never torn. A node with no row,
 * or a node file whose migrations have not run, reads as a sole primary: a box between its first
 * migration and its first role write must still sell.
 */
export async function readNodeMode(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole }> {
  if (!(await tableExists(node, "node_mode"))) return { mode: "primary", singletonRole: "primary" };
  const [row] = await node
    .select({ mode: nodeMode.mode, singletonRole: nodeMode.singletonRole })
    .from(nodeMode)
    .where(eq(nodeMode.nodeId, nodeId));
  return { mode: row?.mode ?? "primary", singletonRole: row?.singletonRole ?? "primary" };
}

/**
 * Sets one node's mode on its own node transaction, after refusing `deployment.not_stamped` when
 * `venue.db` has no stamp: a role must not be recorded for a database nothing has claimed for an
 * environment.
 */
export async function setNodeMode(
  handles: VenueAndNodeHandles,
  nodeId: string,
  mode: DeploymentMode,
): Promise<void> {
  await requireStamp(handles.venue);
  await withNodeTransaction(handles.node, (tx) => setNodeModeTx(tx, nodeId, mode));
}

/**
 * Sets one node's mode on a caller's node transaction, for a caller that has already checked the
 * deployment stamp; this does not read it. `mirror` co-sets `singleton_role = 'secondary'` in the
 * same write, so the pair `node_mode_role_valid_ck` forbids is never written even transiently;
 * `primary` leaves `singleton_role` as it is.
 */
export async function setNodeModeTx(
  tx: NodeTransaction,
  nodeId: string,
  mode: DeploymentMode,
): Promise<void> {
  await tx
    .insert(nodeMode)
    .values({ nodeId, mode, singletonRole: mode === "mirror" ? "secondary" : "primary" })
    .onConflictDoUpdate({
      target: nodeMode.nodeId,
      set:
        mode === "mirror"
          ? { mode, singletonRole: "secondary", updatedAt: now() }
          : { mode, updatedAt: now() },
    });
}

/** Sets one node's singleton role; refuses an unstamped `venue.db` as {@link setNodeMode} does. */
export async function setSingletonRole(
  handles: VenueAndNodeHandles,
  nodeId: string,
  role: SingletonRole,
): Promise<void> {
  await requireStamp(handles.venue);
  await withNodeTransaction(handles.node, (tx) => setSingletonRoleTx(tx, nodeId, role));
}

/**
 * Sets one node's singleton role on a caller's node transaction, for a caller that has already
 * checked the deployment stamp; this does not read it. Creates the row (mode `primary`) if the node
 * has none. `'primary'` on a mirror is refused by `node_mode_role_valid_ck`: a promotion flips the
 * mode first.
 */
export async function setSingletonRoleTx(
  tx: NodeTransaction,
  nodeId: string,
  role: SingletonRole,
): Promise<void> {
  await tx
    .insert(nodeMode)
    .values({ nodeId, singletonRole: role })
    .onConflictDoUpdate({
      target: nodeMode.nodeId,
      set: { singletonRole: role, updatedAt: now() },
    });
}
