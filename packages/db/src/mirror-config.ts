import { sql } from "drizzle-orm";
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
 * The mirror connection config, or `null` when the table/row is absent — a primary or an unstamped
 * database. `null` covers BOTH "the table does not exist yet" and "the table is empty", and callers
 * must not tell them apart: both mean nothing has adopted this database as a mirror.
 *
 * The table's existence is read off `sqlite_master` rather than discovered by running the select and
 * catching the refusal, exactly as `readDeploymentMode`/`readDeploymentEnvironment` do — the reason
 * for that shape, and for the catalogue rather than a pragma, is on `deploymentTableExists` in
 * `./deployment.js`.
 */
export async function readMirrorConfig(db: Database): Promise<MirrorConnection | null> {
  const present = await db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name = ${"mirror_config"}`,
  );
  if (present.rows.length === 0) return null;

  const rows = await db.execute<{
    relay_url: string;
    box_hostname: string;
    box_ca_pem: string;
    origin_node_id: string;
  }>(
    sql`select relay_url, box_hostname, box_ca_pem, origin_node_id from mirror_config where id = 1`,
  );
  const row = rows.rows[0];
  if (row === undefined) return null;
  return {
    relayUrl: row.relay_url,
    boxHostname: row.box_hostname,
    boxCaPem: row.box_ca_pem,
    originNodeId: row.origin_node_id,
  };
}

/**
 * UPSERT of the singleton (`id = 1`). Re-adopting a mirror overwrites the config in place — there
 * is no immutability rule here (unlike `deployment.environment`), because a box can legitimately
 * move relays or rotate its CA.
 *
 * **Nothing in the database refuses another writer this table.** On PostgreSQL `app_user` held no
 * INSERT or UPDATE on `mirror_config`, so only the provisioning connection could write it. This
 * engine has no roles and no grants, and `mirror_config` carries no trigger: an ordinary insert
 * succeeds, measured 2026-09-23 on Node v26.7.0 against the core migration set. That the adopt path
 * is the only writer is now a convention, not something the database holds.
 */
export async function writeMirrorConfig(db: Database, cfg: MirrorConnection): Promise<void> {
  // Uses the Drizzle table object (not raw SQL) — the same split `deployment.ts` uses, where
  // `stampDeployment` writes via `db.insert(deployment)`. `now()` on the update refreshes
  // `adopted_at` each re-adoption; it is the generator the column's own default already uses
  // (`./schema/columns.js`), because the clock is the server's here and not the engine's.
  await db
    .insert(mirrorConfig)
    .values({
      id: 1,
      relayUrl: cfg.relayUrl,
      boxHostname: cfg.boxHostname,
      boxCaPem: cfg.boxCaPem,
      originNodeId: cfg.originNodeId,
    })
    .onConflictDoUpdate({
      target: mirrorConfig.id,
      set: {
        relayUrl: cfg.relayUrl,
        boxHostname: cfg.boxHostname,
        boxCaPem: cfg.boxCaPem,
        originNodeId: cfg.originNodeId,
        adoptedAt: now(),
      },
    });
}
