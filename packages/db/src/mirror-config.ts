import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { now } from "./schema/columns.js";
import { mirrorConfig } from "./schema/mirror-config.js";

/**
 * A cloud mirror's non-secret connection config: where the mirror dials to reach its box and how it
 * trusts the box's TLS.
 */
export interface MirrorConnection {
  relayUrl: string;
  boxHostname: string;
  boxCaPem: string;
  // The nodeId of the PRIMARY this mirror was adopted from — its ORIGIN, distinct from this node's
  // OWN identity (`config.till.nodeId`). See the schema doc on `origin_node_id`.
  originNodeId: string;
}

/**
 * This node's mirror connection config, or `null` when the table is absent or this node has no row.
 * Callers must not tell those two apart: both mean nothing has adopted this node as a mirror.
 *
 * The table's existence is read off `sqlite_master` rather than discovered by running the select and
 * catching the refusal; the reason is on `deploymentTableExists` in `./deployment.js`.
 */
export async function readMirrorConfig(
  db: Database,
  nodeId: string,
): Promise<MirrorConnection | null> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"mirror_config"}`,
  );
  if (present.rows.length === 0) return null;
  const [row] = await db
    .select({
      relayUrl: mirrorConfig.relayUrl,
      boxHostname: mirrorConfig.boxHostname,
      boxCaPem: mirrorConfig.boxCaPem,
      originNodeId: mirrorConfig.originNodeId,
    })
    .from(mirrorConfig)
    .where(eq(mirrorConfig.nodeId, nodeId));
  return row ?? null;
}

/**
 * UPSERT of this node's row. Re-adopting a mirror overwrites the config in place — there
 * is no immutability rule here (unlike `deployment.environment`), because a box can legitimately
 * move relays or rotate its CA.
 *
 * **Nothing in the database refuses another writer this table.** That the adopt path is the only
 * writer is a convention, not something the database holds.
 */
export async function writeMirrorConfig(
  db: Database,
  nodeId: string,
  cfg: MirrorConnection,
): Promise<void> {
  await db
    .insert(mirrorConfig)
    .values({ nodeId, ...cfg })
    .onConflictDoUpdate({
      target: mirrorConfig.nodeId,
      set: { ...cfg, adoptedAt: now() },
    });
}
