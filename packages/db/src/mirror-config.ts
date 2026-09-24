import { eq, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { now } from "./schema/columns.js";
import { mirrorConfig } from "./schema/mirror-config.js";

/**
 * A cloud mirror's non-secret connection config (sync cloud-mirror C2b): where the mirror dials to
 * reach its box and how it trusts the box's TLS. The per-peer sync token is NOT here — it lives in
 * the credentials vault (`sync.mirror_token`). Written at adopt time, read at mirror boot.
 */
export interface MirrorConnection {
  relayUrl: string;
  boxHostname: string;
  boxCaPem: string;
  // The nodeId of the PRIMARY this mirror was adopted from — its ORIGIN, distinct from this node's
  // OWN identity (`config.till.nodeId`). Written at adopt (the primary's nodeId); read at
  // mirror boot into `boot.ts`'s `dataNodeId`, which scopes the node-scoped read paths (report-api's
  // per-till and fiscal reports) to the id the venue's rows carry. See the schema doc on
  // `origin_node_id`.
  originNodeId: string;
}

/**
 * This node's mirror connection config, or `null` when the table is absent or this node has no row.
 * `null` covers BOTH "the table does not exist yet" and "this node has no row", and callers must not
 * tell them apart: both mean nothing has adopted this node as a mirror.
 *
 * The table's existence is read off `sqlite_master` rather than discovered by running the select and
 * catching the refusal, exactly as `readDeploymentAxes`/`readDeploymentEnvironment` do — the reason
 * for that shape, and for the catalogue rather than a pragma, is on `deploymentTableExists` in
 * `./deployment.js`.
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
 * **Nothing in the database refuses another writer this table.** `mirror_config` carries no
 * trigger: an ordinary insert succeeds, measured 2026-09-23 on Node v26.7.0 against the core
 * migration set. That the adopt path is the only writer is a convention, not something the database
 * holds.
 */
export async function writeMirrorConfig(
  db: Database,
  nodeId: string,
  cfg: MirrorConnection,
): Promise<void> {
  // `now()` on the update refreshes `adopted_at` each re-adoption; it is the generator the column's
  // own default already uses (`./schema/columns.js`), because the clock is the server's here and not
  // the engine's.
  await db
    .insert(mirrorConfig)
    .values({ nodeId, ...cfg })
    .onConflictDoUpdate({
      target: mirrorConfig.nodeId,
      set: { ...cfg, adoptedAt: now() },
    });
}
