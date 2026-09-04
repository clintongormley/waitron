import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { mirrorConfig } from "./schema/mirror-config.js";

/**
 * A cloud mirror's non-secret connection config (sync cloud-mirror C2b): where the mirror dials to
 * reach its box and how it trusts the box's TLS. The per-peer sync token is NOT here — it lives in
 * the credentials vault (`sync.mirror_token`). Written owner-role at adopt time; read by `app_user`
 * at mirror boot.
 */
export interface MirrorConnection {
  relayUrl: string;
  boxHostname: string;
  boxCaPem: string;
  // The nodeId of the PRIMARY this mirror pulls from — its sync ORIGIN, distinct from this node's
  // OWN identity (`config.till.nodeId`). Written owner-role at adopt (the primary's nodeId); read at
  // mirror boot to drive the pull peer's origin. See the schema doc on `origin_node_id`.
  originNodeId: string;
}

/**
 * The mirror connection config, or `null` when the table/row is absent — a primary or an unstamped
 * database. `null` covers BOTH "the table does not exist yet" and "the table is empty", and callers
 * must not tell them apart: both mean nothing has adopted this database as a mirror.
 *
 * Uses `to_regclass` rather than catching an undefined-table error, exactly as
 * `readDeploymentMode`/`readDeploymentEnvironment` do: in PostgreSQL a failed statement aborts the
 * enclosing transaction, so probing by failure would poison a transaction the caller may still need.
 */
export async function readMirrorConfig(db: Database): Promise<MirrorConnection | null> {
  const present = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('public.mirror_config') is not null as exists`,
  );
  if (present.rows[0]?.exists !== true) return null;

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
 * Owner-role UPSERT of the singleton (`id = 1`). Re-adopting a mirror overwrites the config in
 * place — there is no immutability rule here (unlike `deployment.environment`), because a box can
 * legitimately move relays or rotate its CA. `app_user` holds no INSERT/UPDATE on `mirror_config`
 * (the grant read-back asserts it), so this runs on the provisioning/owner connection, never the
 * app pool.
 */
export async function writeMirrorConfig(db: Database, cfg: MirrorConnection): Promise<void> {
  // Uses the Drizzle table object (not raw SQL) — the same split `deployment.ts` uses, where
  // `stampDeployment` writes via `db.insert(deployment)`. `now()` on the update refreshes
  // `adopted_at` each re-adoption; the read side keeps its raw `to_regclass` probe.
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
        adoptedAt: sql`now()`,
      },
    });
}
