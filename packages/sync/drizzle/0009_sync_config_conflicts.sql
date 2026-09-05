-- Hand-written custom migration for @waitron/sync (this package has NO drizzle.config.ts — its
-- journal + snapshots are hand-maintained and drizzle-kit never diffs it). Runs LAST in
-- migrations.manifest.json's `sync` set; this migration only CREATEs an ops table + grants, so it has
-- no cross-set ordering dependency (unlike the capture triggers in 0000/0006/0007/0008, which target
-- other packages' tables).
--
-- WHAT THIS BUILDS. The config-conflict surface for membership Slice 7 (spec
-- docs/superpowers/specs/2026-09-02-membership-and-rejoin-wire-protocol-design.md §7): when the
-- serving-primary (the CARRIER) drains a returned/fenced node's tail, a config-class row whose
-- origin_id is NOT the current serving-primary is REJECTED (primary-wins — not applied) and RECORDED
-- here, an append-only cross-node ops log the box-status surface reads for review. It records config
-- writes a returned node made during the partitioned-but-not-dead fence window that primary-wins
-- overrode; the per-field-merge seam (deferred, spec §7) reads row_image.
--
-- NO tenant_id, NO RLS, DELIBERATELY — the same precedent as sync_cursor (0000_sync_outbox.sql:95-99)
-- and node_membership (packages/db/drizzle/0096_node_membership.sql): this is whole-DB operational
-- state (a cross-node ops event), like `deployment`, not tenant business data. Having no tenant_id
-- also keeps it OUT of the fiscal inmutabilidad FORCE-RLS scan by construction — that scan discovers
-- tables by their `tenant_id` column and requires FORCE RLS on each (CLAUDE.md §3). The rejected
-- row's tenant lives inside the row_image jsonb.
CREATE TABLE sync_config_conflicts (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  table_name  text        NOT NULL,   -- the enrolled config table the rejected row targeted
  origin_id   uuid        NOT NULL,   -- the (non-serving-primary) node that produced the rejected write
  lane        text        NOT NULL,   -- the lane the row arrived on
  row_image   jsonb       NOT NULL    -- the rejected row verbatim (the deferred per-field-merge seam); tenant_id lives in here
);
--> statement-breakpoint

-- app_user is the role the apply pool (localSyncDb = an app_user member) writes the record through, and
-- the role the box-status read surface reads through — so INSERT + SELECT to app_user. NO UPDATE/DELETE:
-- this is an append-only ops log (a rejected write is never edited or removed).
GRANT INSERT, SELECT ON sync_config_conflicts TO app_user;
