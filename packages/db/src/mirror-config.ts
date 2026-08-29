import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

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
  }>(sql`select relay_url, box_hostname, box_ca_pem from mirror_config where id = 1`);
  const row = rows.rows[0];
  if (row === undefined) return null;
  return {
    relayUrl: row.relay_url,
    boxHostname: row.box_hostname,
    boxCaPem: row.box_ca_pem,
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
  await db.execute(sql`
    insert into mirror_config (id, relay_url, box_hostname, box_ca_pem)
    values (1, ${cfg.relayUrl}, ${cfg.boxHostname}, ${cfg.boxCaPem})
    on conflict (id) do update set
      relay_url = excluded.relay_url,
      box_hostname = excluded.box_hostname,
      box_ca_pem = excluded.box_ca_pem,
      adopted_at = now()
  `);
}
