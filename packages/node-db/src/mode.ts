import { eq } from "drizzle-orm";
import {
  requireStamp,
  withNodeTransaction,
  type DeploymentMode,
  type NodeDatabase,
  type NodeTransaction,
  type SingletonRole,
} from "@waitron/db";
import type { VenueAndNodeHandles } from "./handles.js";
import { box } from "./schema/box.js";
import { writeBoxRoleTx } from "./box.js";

/**
 * Both of one node's axes from ONE read of its row, so the pair is never torn. A node with no row
 * reads as a sole primary: a box between its first migration and its first role write must still
 * sell.
 */
export async function readNodeMode(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole }> {
  return (await readNodeModeRow(node, nodeId)) ?? { mode: "primary", singletonRole: "primary" };
}

/** Like {@link readNodeMode}, but `null` for a node with no row, for a caller that must tell the two apart. */
export async function readNodeModeRow(
  node: NodeDatabase | NodeTransaction,
  nodeId: string,
): Promise<{ mode: DeploymentMode; singletonRole: SingletonRole } | null> {
  const [row] = await node
    .select({ mode: box.mode, singletonRole: box.singletonRole })
    .from(box)
    .where(eq(box.nodeId, nodeId));
  return row?.mode == null ? null : { mode: row.mode, singletonRole: row.singletonRole! };
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
  const stored = await readNodeMode(tx, nodeId);
  await writeBoxRoleTx(tx, nodeId, { mode, singletonRole: mode === "mirror" ? "secondary" : stored.singletonRole });
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
  const stored = await readNodeMode(tx, nodeId);
  await writeBoxRoleTx(tx, nodeId, { mode: stored.mode, singletonRole: role });
}

/** Makes one node the sole primary (mode and singleton role both `primary`) on a caller's node
 * transaction; like the two writes it makes, it does not read the deployment stamp. */
export async function setPrimaryRoleTx(tx: NodeTransaction, nodeId: string): Promise<void> {
  await writeBoxRoleTx(tx, nodeId, { mode: "primary", singletonRole: "primary" });
}
