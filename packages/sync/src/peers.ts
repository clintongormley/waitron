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

  // The gate is computed by Postgres (`sighting_due`) in the SAME select that resolves the peer, so
  // the JS decision below uses the DB's clock, not the app's, and needs no timestamp parsing.
  const res = await db.execute<{
    token_hash: string;
    subscriber_id: string;
    sighting_due: boolean;
  }>(
    sql`select token_hash, subscriber_id,
               (last_seen_at is null or last_seen_at < now() - interval '1 minute') as sighting_due
        from sync_peers
        where id = ${peerId}::uuid and active = true`,
  );
  const row = res.rows[0];
  if (row === undefined) throw new AppError("sync.node_unauthorized", {});
  if (!verifySecret(secret, row.token_hash)) throw new AppError("sync.node_unauthorized", {});

  // Gated sighting write — auth runs on EVERY pull/report tick (the hot path; the fast lane polls
  // ~1/s), so the second round-trip is SKIPPED entirely, not just no-op'd server-side, unless a minute
  // has passed since the last sighting. Reading `sighting_due` above moves the gate to JS, turning
  // ~one UPDATE per request into ~one per peer per minute. Only last_seen_at is written — the one
  // column the auth-path role (sync_tailer) holds UPDATE on. `and active = true` re-checks revocation:
  // if the peer is revoked in the window between the SELECT and this UPDATE, the sighting is skipped
  // rather than stamping a "last seen" onto a now-revoked row (harmless, but keeps the semantics crisp).
  if (row.sighting_due) {
    await db.execute(
      sql`update sync_peers set last_seen_at = now() where id = ${peerId}::uuid and active = true`,
    );
  }
  return { subscriberId: row.subscriber_id };
}

/** Revoke a peer: active := false. `revoked` is whether a row actually moved (unknown or
 * already-revoked -> false, not an error), so the CLI reports the truth without an exception. A
 * non-uuid id short-circuits to false (it can match nothing). */
export async function revokePeer(db: Database, peerId: string): Promise<{ revoked: boolean }> {
  if (!UUID_RE.test(peerId)) return { revoked: false };
  const res = await db.execute<{ id: string }>(
    sql`update sync_peers set active = false
        where id = ${peerId}::uuid and active = true
        returning id`,
  );
  return { revoked: res.rows.length > 0 };
}

export interface PeerSummary {
  peerId: string;
  subscriberId: string;
  name: string;
  active: boolean;
  lastSeenAt: string | null;
  enrolledAt: string;
}

/** All peers, oldest first, for the CLI (and later C's dashboard). Never selects token_hash. */
export async function listPeers(db: Database): Promise<PeerSummary[]> {
  const res = await db.execute<{
    id: string;
    subscriber_id: string;
    name: string;
    active: boolean;
    last_seen_at: string | null;
    enrolled_at: string;
  }>(
    sql`select id, subscriber_id, name, active, last_seen_at, enrolled_at
        from sync_peers order by enrolled_at`,
  );
  return res.rows.map((r) => ({
    peerId: r.id,
    subscriberId: r.subscriber_id,
    name: r.name,
    active: r.active,
    lastSeenAt: r.last_seen_at,
    enrolledAt: r.enrolled_at,
  }));
}
