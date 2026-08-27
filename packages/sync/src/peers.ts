// The per-peer subscriber-identity core for the sync source (spec §6). Reuses the identity scrypt
// (hashSecret/verifySecret) and the ${id}.${secret} bearer shape print-agents use — no crypto is
// written here. Runs directly on the pool: sync_peers has no RLS, so no withTenant, like
// recordSubscriberCursor (cursor-report.ts). Every auth failure folds into one sync.node_unauthorized
// (oracle-free — the response confirms neither a peer's existence nor its revocation state).
import "./errors.js";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { type Database } from "@waitron/db";
import { hashSecret, verifySecret } from "@waitron/identity";

/** Bytes of entropy in the token's secret half — 256 bits, base64url (the device/print-agent width). */
const TOKEN_BYTES = 32;

/** Anchored UUID shape check for the selector half. A non-uuid selector against the `uuid` column
 * would raise 22P02 -> an opaque 500; a forged bearer must stay a clean sync.node_unauthorized.
 * Re-declared here (not imported) — @waitron/shared's validator is unexported, the agent.ts reason. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EnrolPeerInput {
  subscriberId: string;
  name: string;
}

/** Mint a peer's bearer token, store its scrypt hash, return the plaintext ONCE. The token is
 * `${peerId}.${secret}`: a SELECTOR (the row id, needed to fetch the per-row scrypt salt) + a
 * VALIDATOR (the secret authenticatePeer checks). The plaintext leaves this module only here. */
export async function enrolPeer(
  db: Database,
  input: EnrolPeerInput,
): Promise<{ peerId: string; token: string }> {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  const res = await db.execute<{ id: string }>(
    sql`insert into sync_peers (subscriber_id, name, token_hash)
        values (${input.subscriberId}, ${input.name}, ${hashSecret(secret)})
        returning id`,
  );
  const peerId = res.rows[0]!.id;
  return { peerId, token: `${peerId}.${secret}` };
}

/** Resolve a presented bearer token to its subscriber_id, or throw sync.node_unauthorized. The
 * `active = true` filter is the revocation control (a revoked peer is simply not found -> instant
 * revoke). verifySecret is constant-time; the secret is never compared with ===. */
export async function authenticatePeer(
  db: Database,
  token: string,
): Promise<{ subscriberId: string }> {
  // Split on the FIRST dot: reject a missing separator, empty selector, or empty secret.
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) throw new AppError("sync.node_unauthorized", {});
  const peerId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!UUID_RE.test(peerId)) throw new AppError("sync.node_unauthorized", {});

  const res = await db.execute<{ token_hash: string; subscriber_id: string }>(
    sql`select token_hash, subscriber_id from sync_peers
        where id = ${peerId}::uuid and active = true`,
  );
  const row = res.rows[0];
  if (row === undefined) throw new AppError("sync.node_unauthorized", {});
  if (!verifySecret(secret, row.token_hash)) throw new AppError("sync.node_unauthorized", {});

  // Gated sighting write — skip if already seen within the last minute (the print-agent gate). Only
  // last_seen_at is written, the one column the auth-path role holds UPDATE on.
  await db.execute(
    sql`update sync_peers set last_seen_at = now()
        where id = ${peerId}::uuid
          and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`,
  );
  return { subscriberId: row.subscriber_id };
}
