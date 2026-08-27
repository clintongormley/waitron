-- Hand-written custom migration (drizzle-kit generate --custom): drizzle-kit models no roles or
-- grants, so none of this survives a later `generate`. 0005_snapshot.json carries a fresh `id` with
-- `prevId` set to 0004's snapshot id, continuing the drizzle-kit chain the way every sync snapshot
-- 0000→0004 does (each a distinct id, prevId = the previous id); its `tables` stay `{}` because the
-- whole sync package is raw SQL drizzle-kit never models — again as all of 0000→0004 are. A
-- grant/role-only migration still advancing this chain is the payments 0007→0008 precedent. Runs in
-- migrations.manifest.json's `sync` set after 0000-0004, so sync_tailer (0000) and sync_retention
-- (0001) already exist.
--
-- WHAT THIS BUILDS. Per-peer subscriber identity for the sync source (spec
-- docs/superpowers/specs/2026-08-27-sync-cloud-mirror-peer-identity-design.md §4/§5). One node-level
-- table binding each subscriber's bearer token to a fixed subscriber_id, so the source derives
-- identity from the token, never from the request body. NO tenant_id and NO RLS: peer identity is
-- whole-DB operational state like sync_cursor (0000_sync_outbox.sql:95-99), which also keeps it out
-- of the fiscal inmutabilidad FORCE-RLS scan by construction (that scan keys on a tenant_id column).
CREATE TABLE sync_peers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id text        NOT NULL,
  name          text        NOT NULL,
  token_hash    text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  last_seen_at  timestamptz,
  enrolled_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- The auth path (the sync-api pool, a sync_tailer member) reads sync_peers. SELECT for the token
-- lookup; a COLUMN-level UPDATE(last_seen_at) for the sighting write ONLY, so the hot auth path can
-- never flip `active` (the revocation control). Deliberately narrower than app_user's full UPDATE on
-- print_agents — least privilege on a distrusting-peer boundary (spec §5).
GRANT SELECT ON sync_peers TO sync_tailer;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON sync_peers TO sync_tailer;
--> statement-breakpoint

-- The operator/CLI path (waitron-sync-peer) connects as a sync_retention member — the role
-- waitron-sync-evict already uses. SELECT/INSERT/UPDATE for enrol/revoke/list. NO DELETE: a peer is
-- deactivated (active := false), never hard-deleted, matching print_agents and the sync_log/sync_cursor
-- grant discipline (0001/0003).
GRANT SELECT, INSERT, UPDATE ON sync_peers TO sync_retention;
